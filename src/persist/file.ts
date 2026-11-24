// 파일 내보내기/불러오기 (.json). PC는 다운로드, 폰은 공유 시트가 되면 공유 시트
import { SAVE_VERSION } from '../config';

export async function exportJson(filename: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data);
  const blob = new Blob([text], { type: 'application/json' });
  const isTouch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0 && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  try {
    const file = new File([blob], filename, { type: 'application/json' });
    if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch { /* 공유 취소 또는 미지원 → 다운로드 */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickJsonFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error('파일 없음'));
      try { resolve(JSON.parse(await f.text())); } catch (e) { reject(e); }
    };
    input.click();
  });
}

/** 저장 형식 버전 변환 (예전 파일도 불러올 수 있게) */
export function migrateSave(raw: any): any {
  if (!raw || typeof raw !== 'object') throw new Error('저장 파일 형식이 아니에요');
  if (raw.kind !== 'holdem-pub-save') throw new Error('홀덤펍 저장 파일이 아니에요');
  let v = raw.version ?? 0;
  if (v > SAVE_VERSION) throw new Error('더 새로운 버전의 파일이에요. 앱을 업데이트해 주세요');
  // v0 → v1: (예시) reports 필드 추가
  if (v < 1) { raw.reports ??= []; v = 1; }
  raw.version = v;
  return raw;
}
