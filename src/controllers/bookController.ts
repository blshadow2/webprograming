// bookController — 요청 해석, 입력 검증, 상태 코드와 응답 결정
// 데이터 접근은 bookStore 함수에 위임한다. 모든 오류 응답은 { message } JSON으로 한다.

// 이름 / 학번

import type { RequestHandler } from 'express';
import * as store from '../stores/bookStore.js';
import { isReadingStatus } from '../types.js';
import type {
  BookChanges, CreateBookBody, IdParams, ListOptions, ListQuery,
  UpdateBookBody,
} from '../types.js';

// ── 보조 함수 (모듈 내부 전용 — export하지 않음) ─────────
// 여러 요청 처리 함수에서 반복되는 검증은 보조 함수로 분리하여 이 영역에 작성한다.


function nonEmptyTrimmed(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function isRating(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5);
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const tags = new Set<string>();
  for (const item of value) {
    const name = nonEmptyTrimmed(item);
    if (name === undefined) return undefined;
    tags.add(name);
  }
  return [...tags];
}

// ── 요청 처리 함수 ────────────────────────────────────

// TODO 11: GET /books
//   - status: 'want' · 'reading' · 'done' 중 하나가 아니면 400 (생략 시 조건 없음)
//   - keyword, tag: 앞뒤 공백 제거 후 빈 문자열이면 조건 없음 (생략 시 조건 없음)
//                   같은 이름이 여러 번 오면 배열로 도착하므로 문자열이 아니면 400
//   - 200 + 조건에 맞는 도서 배열
export const list: RequestHandler<{}, unknown, unknown, ListQuery> =
  async (req, res) => {
    const { status, keyword, tag } = req.query;
    const options: ListOptions = {};
    if (status !== undefined) {
      if (!isReadingStatus(status)) {
        res.status(400).json({ message: '올바르지 않은 독서 상태' });
        return;
      }
      options.status = status;
    }
    if ((keyword !== undefined && typeof keyword !== 'string')
      || (tag !== undefined && typeof tag !== 'string')) {
      res.status(400).json({ message: 'keyword와 tag는 문자열이어야 합니다' });
      return;
    }
    const trimmedKeyword = nonEmptyTrimmed(keyword);
    const trimmedTag = nonEmptyTrimmed(tag);
    if (trimmedKeyword !== undefined) options.keyword = trimmedKeyword;
    if (trimmedTag !== undefined) options.tag = trimmedTag;

    res.json(await store.findAll(options));
  };

// [제공 예시] GET /books/:id (수정 불필요)
// id 형식은 validateId가 이미 검사했으므로 여기서는 존재 여부만 판단한다.
// store의 비동기 함수를 await로 호출하는 Controller의 형태를 참고하라.
export const getById: RequestHandler<IdParams> = async (req, res) => {
  const book = await store.findById(Number(req.params.id));
  if (!book) {
    res.status(404).json({ message: '도서 없음' });
    return;
  }
  res.json(book);
};

// TODO 12: POST /books
//   - title, author: 필수, 문자열, 앞뒤 공백 제거 후 빈 문자열이면 400
//                    (저장도 공백을 제거한 값으로 함)
//   - status: 생략 시 'want', 허용 값이 아니면 400
//   - memo  : 생략 시 '', 문자열이 아니면 400
//   - rating: 생략 또는 null이면 null, 1~5 정수가 아니면 400,
//             status가 'done'이 아닌데 별점이 있으면 400
//   - tags  : 생략 시 [] (태그 없이 등록), 배열이 아니면 400
//             각 항목이 문자열이 아니거나 앞뒤 공백 제거 후 빈 문자열이면 400
//             각 이름은 앞뒤 공백을 제거하고, 같은 이름은 하나만 남긴다.
//             예) ["개발", " 데이터베이스 ", "개발"] → ["개발", "데이터베이스"]
//   - 같은 제목 + 저자의 중복 검사는 하지 않는다.
//     (데이터베이스의 고유 제약 → P2002 → 에러 핸들러가 409 응답)
//   - 성공하면 201 + 태그 목록을 포함한 저장된 도서
export const create:
  RequestHandler<{}, unknown, CreateBookBody | undefined> =
  async (req, res) => {
    const { status = 'want', rating = null, memo = '', tags = [] } = req.body ?? {};
    const title = nonEmptyTrimmed(req.body?.title);
    const author = nonEmptyTrimmed(req.body?.author);
    if (title === undefined || author === undefined) {
      res.status(400).json({ message: '제목과 저자를 입력해야 합니다' });
      return;
    }
    if (!isReadingStatus(status) || !isRating(rating) || typeof memo !== 'string') {
      res.status(400).json({ message: '상태, 별점 또는 메모 형식이 올바르지 않습니다' });
      return;
    }
    if (rating !== null && status !== 'done') {
      res.status(400).json({ message: '완독한 도서에만 별점을 줄 수 있습니다' });
      return;
    }
    const normalizedTags = normalizeTags(tags);
    if (normalizedTags === undefined) {
      res.status(400).json({ message: 'tags는 비어 있지 않은 이름의 배열이어야 합니다' });
      return;
    }

    const book = await store.create({ title, author, status, rating, memo, tags: normalizedTags });
    res.status(201).json(book);
  };

// TODO 13: PATCH /books/:id — status, rating, memo만 수정할 수 있음
//   ① status, rating, memo가 하나도 없으면 400
//   ② 형식 검증 — 위반하면 400
//        status: 허용 값 / rating: 1~5 정수 또는 null / memo: 문자열
//   ③ 대상 도서가 없으면 404
//   ④ 수정 후의 상태가 'done'이 아닌데 rating(null 제외)을 보내면 400
//   ⑤ 성공하면 200 + 수정된 도서 (store.update가 null을 반환하면 404)
export const update:
  RequestHandler<IdParams, unknown, UpdateBookBody | undefined> =
  async (req, res) => {
    const { status, rating, memo } = req.body ?? {};
    if (status === undefined && rating === undefined && memo === undefined) {
      res.status(400).json({ message: '수정할 상태, 별점 또는 메모가 필요합니다' });
      return;
    }
    if ((status !== undefined && !isReadingStatus(status))
      || (rating !== undefined && !isRating(rating))
      || (memo !== undefined && typeof memo !== 'string')) {
      res.status(400).json({ message: '상태, 별점 또는 메모 형식이 올바르지 않습니다' });
      return;
    }

    const id = Number(req.params.id);
    const book = await store.findById(id);
    if (!book) {
      res.status(404).json({ message: '도서 없음' });
      return;
    }
    if (rating !== undefined && rating !== null && (status ?? book.status) !== 'done') {
      res.status(400).json({ message: '완독한 도서에만 별점을 줄 수 있습니다' });
      return;
    }

    const changes: BookChanges = {};
    if (status !== undefined) changes.status = status;
    if (rating !== undefined) changes.rating = rating;
    if (memo !== undefined) changes.memo = memo;
    const updated = await store.update(id, changes);
    if (!updated) {
      res.status(404).json({ message: '도서 없음' });
      return;
    }
    res.json(updated);
  };

// TODO 14: DELETE /books/:id — 성공하면 204(본문 없음), 대상이 없으면 404
export const remove: RequestHandler<IdParams> = async (req, res) => {
  if (!await store.remove(Number(req.params.id))) {
    res.status(404).json({ message: '도서 없음' });
    return;
  }
  res.status(204).end();
};
