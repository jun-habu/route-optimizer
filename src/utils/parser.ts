import type { ParsedEntry } from '../types';

/** 全47都道府県の正規表現パターン */
const PREFECTURES = [
  '北海道',
  '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

/** 都道府県から始まる住所パターン */
const PREFECTURE_REGEX = new RegExp(
  `((?:${PREFECTURES.join('|')}).+)$`
);

/** 市区町村から始まる住所パターン（都道府県省略） */
const CITY_REGEX = /(\S*[市区町村郡].+)$/;

/** 全角数字を半角数字に変換する */
function toHalfWidthNumbers(text: string): string {
  return text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFFF0)
  );
}

/** （株）、(株)、株式会社 などの企業表記を一時的にマスクするためのプレースホルダー */
const COMPANY_PATTERNS: { pattern: RegExp; placeholder: string }[] = [
  { pattern: /（株）/g, placeholder: '\x00KABUSHIKI_ZENKAKU\x00' },
  { pattern: /\(株\)/g, placeholder: '\x00KABUSHIKI_HANKAKU\x00' },
  { pattern: /株式会社/g, placeholder: '\x00KABUSHIKIGAISHA\x00' },
  { pattern: /（有）/g, placeholder: '\x00YUUGEN_ZENKAKU\x00' },
  { pattern: /\(有\)/g, placeholder: '\x00YUUGEN_HANKAKU\x00' },
  { pattern: /有限会社/g, placeholder: '\x00YUUGENGAISHA\x00' },
  { pattern: /（合）/g, placeholder: '\x00GOUDOU_ZENKAKU\x00' },
  { pattern: /\(合\)/g, placeholder: '\x00GOUDOU_HANKAKU\x00' },
  { pattern: /合同会社/g, placeholder: '\x00GOUDOUGAISHA\x00' },
  { pattern: /合名会社/g, placeholder: '\x00GOUMEIGAISHA\x00' },
  { pattern: /合資会社/g, placeholder: '\x00GOUSHIGAISHA\x00' },
];

/** プレースホルダーを元の文字列に戻す */
function restoreCompanyPatterns(text: string): string {
  let result = text;
  result = result.replace(/\x00KABUSHIKI_ZENKAKU\x00/g, '（株）');
  result = result.replace(/\x00KABUSHIKI_HANKAKU\x00/g, '(株)');
  result = result.replace(/\x00KABUSHIKIGAISHA\x00/g, '株式会社');
  result = result.replace(/\x00YUUGEN_ZENKAKU\x00/g, '（有）');
  result = result.replace(/\x00YUUGEN_HANKAKU\x00/g, '(有)');
  result = result.replace(/\x00YUUGENGAISHA\x00/g, '有限会社');
  result = result.replace(/\x00GOUDOU_ZENKAKU\x00/g, '（合）');
  result = result.replace(/\x00GOUDOU_HANKAKU\x00/g, '(合)');
  result = result.replace(/\x00GOUDOUGAISHA\x00/g, '合同会社');
  result = result.replace(/\x00GOUMEIGAISHA\x00/g, '合名会社');
  result = result.replace(/\x00GOUSHIGAISHA\x00/g, '合資会社');
  return result;
}

/**
 * テキストから日本の住所を抽出してパースする。
 * 各行から住所部分を正規表現で抽出し、住所の前の部分をラベル（企業名等）として返す。
 */
export function parseInputText(text: string): ParsedEntry[] {
  const lines = text.split('\n');
  const results: ParsedEntry[] = [];

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine === '') continue;

    // 全角数字を半角に変換
    let processedLine = toHalfWidthNumbers(trimmedLine);

    // 企業表記をマスク（住所抽出に干渉しないように）
    let maskedLine = processedLine;
    for (const { pattern, placeholder } of COMPANY_PATTERNS) {
      maskedLine = maskedLine.replace(pattern, placeholder);
    }

    // 都道府県パターンで住所抽出を試みる
    let match = PREFECTURE_REGEX.exec(maskedLine);

    // 都道府県が見つからなければ市区町村パターンで試みる
    if (!match) {
      match = CITY_REGEX.exec(maskedLine);
    }

    if (!match) continue;

    const addressPart = restoreCompanyPatterns(match[1].trim());
    const matchIndex = match.index;
    const labelPart = restoreCompanyPatterns(maskedLine.substring(0, matchIndex).trim());

    results.push({
      originalLine: trimmedLine,
      address: addressPart,
      label: labelPart,
    });
  }

  return results;
}
