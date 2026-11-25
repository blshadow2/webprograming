// noteStore — 독서 노트 데이터의 등록, 삭제 담당

// 이름 / 학번

import { prisma } from '../db.js';
import type { Note } from '../generated/prisma/client.js';
import { isPrismaError } from './prismaError.js';
import type { NewNote } from '../types.js';

// TODO 8: bookId 도서에 노트를 등록하고, 저장한 노트를 반환하라.
//   - 외래키 bookId에 경로의 도서 id를 저장한다. (도서를 먼저 조회하지 않음)
//   - bookId에 해당하는 도서가 없을 때의 오류(P2003)만 null로 바꾸고,
//     그 밖의 오류는 다시 던진다.
//   - [설명] 주석 한 줄로 P2003이 발생하는 이유와 null로 바꾸어 반환하는 이유를 남겨라.
export async function create(
  bookId: number, input: NewNote,
): Promise<Note | null> {
  try {
    return await prisma.note.create({ data: { ...input, bookId } });
  } catch (error) {
    // [설명] 도서가 없으면 외래키 제약으로 P2003이 발생하므로, 컨트롤러가 404로 응답하도록 null을 반환한다.
    if (isPrismaError(error, 'P2003')) return null;
    throw error;
  }
}

// TODO 9: bookId 도서에 속한 id 노트를 삭제하라. 삭제했으면 true, 대상이 없으면(P2025) false.
//   - 다른 도서의 경로로 보낸 요청(예: DELETE /books/1/notes/7)으로는 삭제되지 않아야 한다.
//   - [설명] 주석 한 줄로 where에 id와 bookId를 함께 지정하는 이유를 남겨라.
export async function remove(bookId: number, id: number): Promise<boolean> {
  try {
    // [설명] 요청 경로의 도서에 속한 노트만 삭제하도록 id와 bookId를 함께 지정한다.
    await prisma.note.delete({ where: { id, bookId } });
    return true;
  } catch (error) {
    if (isPrismaError(error, 'P2025')) return false;
    throw error;
  }
}
