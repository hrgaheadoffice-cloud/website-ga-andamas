// src/lib/utils.ts

export function formatRupiah(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const CATEGORY_CODE_MAP: Record<string, string> = {
  'Network': 'N',
  'Laptop & Komputer': 'LPT',
  'Komputer / Laptop': 'KOM',
  'Komputer': 'KOM',
  'Laptop': 'KOM',
  'Air Conditioner': 'AC',
  'AC': 'AC',
  'Elektronik': 'ELK',
  'Mebel / Perabotan': 'FURN',
  'Mebel': 'FURN',
  'Perabotan': 'FURN',
  'Kendaraan': 'KND',
  'Server': 'SVR',
  'NVR': 'NVR',
  'UPS': 'UPS',
  'Tools': 'TLS',
  'Peralatan': 'TLS',
};

const ROMAN_MONTHS = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 
  'VII', 'VIII', 'IX', 'X', 'XI', 'XII'
];

export function getCategoryCode(categoryName?: string | null): string {
  if (!categoryName) return 'AST';
  const cleanCat = categoryName.trim();
  if (CATEGORY_CODE_MAP[cleanCat]) {
    return CATEGORY_CODE_MAP[cleanCat];
  }
  const lettersOnly = cleanCat.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return lettersOnly.substring(0, 3) || 'AST';
}

interface GenerateAssetTagParams {
  branchCode?: string | null;
  category?: string | null;
  sequenceNumber?: number;
  date?: Date;
}

export function generateAssetTag({
  branchCode,
  category,
  sequenceNumber = 1,
  date = new Date(),
}: GenerateAssetTagParams): string {
  const ptCode = (branchCode || 'HO').trim().toUpperCase();
  const catCode = getCategoryCode(category);
  const monthRoman = ROMAN_MONTHS[date.getMonth()];
  const yearTwoDigits = date.getFullYear().toString().slice(-2);
  const formattedSeq = String(sequenceNumber).padStart(3, '0');

  return `${ptCode}/${catCode}/${monthRoman}/${yearTwoDigits}/${formattedSeq}`;
}
