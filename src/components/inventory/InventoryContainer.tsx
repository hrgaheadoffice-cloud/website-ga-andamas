'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, 
  Filter, 
  Plus, 
  Upload, 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft,
  ChevronsRight,
  HelpCircle,
  ArrowUpDown,
  ArrowLeft,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  QrCode,
  Eye,
  Handshake,
  Tag,
  Check,
  X,
  Download,
  PieChart
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getAssets, getAssetsForExport, toggleAssetLabelStatus } from '@/lib/actions/assets';
import type { AssetWithRelations, BranchAssetStats } from '@/lib/actions/assets';
import type { Branch, AssetStatus } from '@prisma/client';
import { type AuthUser, ASSET_CATEGORIES } from '@/types';
import AssetDetailModal from '@/components/modals/AssetDetailModal';
import AssetImportModal from '@/components/modals/AssetImportModal';
import QrLabelModal from '@/components/modals/QrLabelModal';
import styles from '@/app/(dashboard)/inventaris/inventaris.module.css';

function formatRupiah(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function getDisplayAssetTag(asset: AssetWithRelations, index: number): string {
  if (asset.assetTag && asset.assetTag.trim() !== '') {
    return asset.assetTag;
  }
  
  const branchCode = asset.branch?.code || 'HO';
  
  const catMap: Record<string, string> = {
    'Elektronik': 'ELK',
    'Komputer / Laptop': 'KOM',
    'Komputer': 'KOM',
    'Laptop': 'KOM',
    'Peralatan Kantor': 'TLS',
    'Mebel / Perabotan': 'FURN',
    'Kendaraan': 'KND'
  };
  
  const catCode = (asset.category && catMap[asset.category]) 
    ? catMap[asset.category] 
    : (asset.category ? asset.category.substring(0, 3).toUpperCase() : 'AST');

  const date = asset.createdAt ? new Date(asset.createdAt) : new Date();
  const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const monthRoman = ROMAN_MONTHS[date.getMonth()];
  const yearTwoDigits = date.getFullYear().toString().slice(-2);
  const formattedSeq = String(asset.id || index + 1).padStart(3, '0');

  return `${branchCode}/${catCode}/${monthRoman}/${yearTwoDigits}/${formattedSeq}`;
}

/**
 * Builds a compact, ellipsis-aware page number list so pagination stays usable
 * even when totalPages is in the hundreds/thousands.
 * e.g. current=31, total=516 -> [1, 'dots', 30, 31, 32, 'dots', 516]
 */
function getPaginationRange(current: number, total: number, siblingCount: number = 1): (number | 'dots')[] {
  const totalSlots = siblingCount * 2 + 5; // firstPage + lastPage + current + 2 siblings + 2 dots-worth of slack

  if (total <= totalSlots) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const leftSibling = Math.max(current - siblingCount, 1);
  const rightSibling = Math.min(current + siblingCount, total);

  const showLeftDots = leftSibling > 2;
  const showRightDots = rightSibling < total - 1;

  if (!showLeftDots && showRightDots) {
    const leftItemCount = 3 + siblingCount * 2;
    const leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);
    return [...leftRange, 'dots', total];
  }

  if (showLeftDots && !showRightDots) {
    const rightItemCount = 3 + siblingCount * 2;
    const rightRange = Array.from({ length: rightItemCount }, (_, i) => total - rightItemCount + i + 1);
    return [1, 'dots', ...rightRange];
  }

  const middleRange = Array.from({ length: rightSibling - leftSibling + 1 }, (_, i) => leftSibling + i);
  return [1, 'dots', ...middleRange, 'dots', total];
}

interface InventoryContainerProps {
  user: AuthUser;
  branches: Branch[];
  branchStats?: BranchAssetStats[];
}

interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

const EXTENDED_CATEGORIES = [
  'Laptop & Komputer',
  ...ASSET_CATEGORIES.filter(c => c !== 'Laptop & Komputer')
];

const BRANCH_ACCENTS = [
  { solid: '#4f46e5', soft: '#eef2ff', text: '#4338ca' },
  { solid: '#0ea5e9', soft: '#f0f9ff', text: '#0369a1' },
  { solid: '#059669', soft: '#ecfdf5', text: '#047857' },
  { solid: '#d97706', soft: '#fffbeb', text: '#b45309' },
  { solid: '#db2777', soft: '#fdf2f8', text: '#be185d' },
  { solid: '#7c3aed', soft: '#f5f3ff', text: '#6d28d9' },
  { solid: '#0d9488', soft: '#f0fdfa', text: '#0f766e' },
];

const CATEGORY_CHART_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#d946ef', '#ec4899', '#64748b', '#78716c', '#0ea5e9',
];

function CategoryDonutChart({ slices, totalValue }: {
  slices: DonutSlice[];
  totalValue: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const total = totalValue;
  const size = 220;
  const center = size / 2;
  const radius = 82;
  const stroke = 30;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  const handleSliceMove = (e: React.MouseEvent, idx: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setHoverIdx(idx);
  };

  const hoveredSlice = hoverIdx !== null ? slices[hoverIdx] : null;
  const hoveredPct = hoveredSlice && total > 0 ? Math.round((hoveredSlice.value / total) * 1000) / 10 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)', width: '100%' }}>
      <div ref={containerRef} style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-border, #e2e8f0)"
            strokeWidth={stroke}
            opacity={total === 0 ? 1 : 0.2}
          />
          {total > 0 && slices.map((slice, idx) => {
            if (slice.value <= 0) return null;
            const fraction = slice.value / total;
            const dash = fraction * circumference;
            const gap = circumference - dash;
            const offset = -cumulative * circumference;
            cumulative += fraction;
            const isDimmed = hoverIdx !== null && hoverIdx !== idx;
            return (
              <circle
                key={idx}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={hoverIdx === idx ? stroke + 5 : stroke}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                opacity={isDimmed ? 0.32 : 1}
                style={{
                  transition: 'stroke-dasharray 0.4s ease, opacity 0.2s ease, stroke-width 0.15s ease',
                  cursor: 'pointer',
                }}
                onMouseMove={(e) => handleSliceMove(e, idx)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            );
          })}
        </svg>
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Total Aset:</span>
          <span style={{ fontSize: '30px', fontWeight: 800, lineHeight: 1, marginTop: 4, color: '#0f172a' }}>{total}</span>
        </div>

        {hoveredSlice && (
          <div style={{
            position: 'absolute',
            left: Math.min(Math.max(tooltipPos.x + 14, 4), size - 12),
            top: Math.min(Math.max(tooltipPos.y - 12, 4), size - 12),
            transform: 'translate(0, -100%)',
            background: '#0f172a',
            color: '#ffffff',
            padding: '8px 12px',
            borderRadius: 10,
            fontSize: 'var(--text-xs)',
            lineHeight: 1.4,
            boxShadow: '0 12px 26px -10px rgba(15,23,42,0.5)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: hoveredSlice.color, flexShrink: 0 }} />
              {hoveredSlice.label}
            </div>
            <div style={{ opacity: 0.85, marginTop: 2 }}>{hoveredSlice.value} unit &middot; {hoveredPct}%</div>
          </div>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(140px, 1fr))',
        gap: 'var(--space-1) var(--space-6)',
        width: '100%',
      }}>
        {slices.map((slice, idx) => (
          <div
            key={idx}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 8px',
              borderRadius: 8,
              backgroundColor: hoverIdx === idx ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
              transition: 'background-color 0.15s ease',
              cursor: 'default',
            }}
          >
            <span style={{
              width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
              backgroundColor: slice.color,
              boxShadow: hoverIdx === idx ? `0 0 0 3px ${slice.color}33` : 'none',
              transition: 'box-shadow 0.15s ease',
            }} />
            <span style={{ fontSize: 'var(--text-xs)', color: '#475569', flex: 1, fontWeight: hoverIdx === idx ? 700 : 500 }}>{slice.label}</span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: '#0f172a' }}>{slice.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStackedBar({ aktif, servis, rusak, hilang }: {
  aktif: number; servis: number; rusak: number; hilang: number;
}) {
  const total = aktif + servis + rusak + hilang;
  if (total === 0) {
    return (
      <div style={{ height: 8, borderRadius: 999, backgroundColor: 'var(--color-border, #e2e8f0)', opacity: 0.5 }} />
    );
  }
  const seg = (val: number, color: string) => val > 0 ? (
    <div style={{ width: `${(val / total) * 100}%`, backgroundColor: color, height: '100%' }} />
  ) : null;

  return (
    <div style={{
      display: 'flex',
      height: 8,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: 'var(--color-border, #e2e8f0)',
    }}>
      {seg(aktif, 'var(--color-success, #22c55e)')}
      {seg(servis, 'var(--color-primary, #3b82f6)')}
      {seg(rusak, 'var(--color-danger, #ef4444)')}
      {seg(hilang, 'var(--color-text-muted, #94a3b8)')}
    </div>
  );
}

function KpiCard({ icon, label, value, valueColor, percentOfTotal, barColor, iconBg, caption }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  valueColor?: string;
  percentOfTotal: number;
  barColor: string;
  gradient?: string;
  iconBg: string;
  caption?: string;
}) {
  return (
    <div
      className="iac-kpi-card"
      style={{
        position: 'relative',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        borderRadius: 16,
        background: '#ffffff',
        border: '1px solid #eef1f6',
        boxShadow: '0 6px 18px -14px rgba(15, 23, 42, 0.25)',
        overflow: 'hidden',
        isolation: 'isolate',
      }}
    >
      {/* decorative vector blob — soft tinted shadow tucked into the corner */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -34,
          right: -34,
          width: 110,
          height: 110,
          borderRadius: '50%',
          background: barColor,
          opacity: 0.08,
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -6,
          right: 14,
          width: 46,
          height: 46,
          borderRadius: '50%',
          background: barColor,
          opacity: 0.06,
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', position: 'relative', zIndex: 1 }}>
        <div style={{
          width: '44px',
          height: '44px',
          borderRadius: '12px',
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          flexShrink: 0,
          boxShadow: `0 8px 16px -8px ${barColor}66`,
        }}>
          {icon}
        </div>
        <span style={{
          fontSize: '11px',
          fontWeight: 700,
          color: barColor,
          background: `${barColor}14`,
          padding: '3px 8px',
          borderRadius: 999,
          whiteSpace: 'nowrap',
        }}>
          {Math.round(Math.min(100, percentOfTotal))}%
        </span>
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <p style={{ fontSize: 'var(--text-xs)', margin: 0, color: '#64748b', fontWeight: 600 }}>{label}</p>
        <h3 style={{ fontSize: 'var(--text-xl)', margin: '2px 0 0 0', color: valueColor || '#0f172a', fontWeight: 800 }}>{value}</h3>
        {caption && (
          <p style={{ fontSize: '11px', margin: '4px 0 0 0', color: '#94a3b8', fontWeight: 500 }}>{caption}</p>
        )}
      </div>

      <div style={{ height: 6, borderRadius: 999, backgroundColor: '#f1f5f9', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        <div style={{
          width: `${Math.min(100, percentOfTotal)}%`,
          height: '100%',
          backgroundColor: barColor,
          borderRadius: 999,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  );
}

export default function InventoryContainer({ user, branches, branchStats = [] }: InventoryContainerProps) {
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [jumpToPageInput, setJumpToPageInput] = useState<string>('');

  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);

  const [assets, setAssets] = useState<AssetWithRelations[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [categoryAssets, setCategoryAssets] = useState<AssetWithRelations[]>([]);
  const [categoryStatsLoading, setCategoryStatsLoading] = useState<boolean>(true);

  const [selectedAsset, setSelectedAsset] = useState<AssetWithRelations | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState<boolean>(false);
  const [qrLabelModalOpen, setQrLabelModalOpen] = useState<boolean>(false);
  const [createMode, setCreateMode] = useState<boolean>(false);
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [togglingLabelId, setTogglingLabelId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);

  const activeFiltersCount = [branchId, status, category].filter(Boolean).length;

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 450);

    return () => clearTimeout(handler);
  }, [search]);

  const handleFilterChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    setPage(1);
  };

  useEffect(() => {
    const loadAssets = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getAssets({
          search: debouncedSearch,
          branchId: branchId ? Number(branchId) : undefined,
          status: (status || undefined) as AssetStatus | undefined,
          category: category || undefined,
          page,
          limit: 10,
          sortBy,
          sortOrder,
        });

        if (result.success && result.data) {
          setAssets(result.data.assets);
          setTotalCount(result.data.totalCount);
          setTotalPages(result.data.totalPages);
        } else {
          setError(result.error || 'Gagal memuat daftar inventaris.');
        }
      } catch (err) {
        console.error('Fetch assets client error:', err);
        setError('Koneksi terputus. Gagal menghubungi server.');
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, [debouncedSearch, branchId, status, category, page, refreshTrigger, sortBy, sortOrder]);

  useEffect(() => {
    if (user.role !== 'SUPERADMIN') return;

    let cancelled = false;

    const loadCategoryStats = async () => {
      setCategoryStatsLoading(true);
      try {
        const result = await getAssetsForExport();
        if (!cancelled && result.success && result.assets) {
          setCategoryAssets(result.assets);
        }
      } catch (err) {
        console.error('Fetch category stats error:', err);
      } finally {
        if (!cancelled) setCategoryStatsLoading(false);
      }
    };

    loadCategoryStats();

    return () => {
      cancelled = true;
    };
  }, [refreshTrigger, user.role]);

  const categorySlices: DonutSlice[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of categoryAssets) {
      const key = asset.category && asset.category.trim() !== '' ? asset.category : 'Lainnya';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, value], idx) => ({
        label,
        value,
        color: CATEGORY_CHART_COLORS[idx % CATEGORY_CHART_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [categoryAssets]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearch('');
    setBranchId('');
    setStatus('');
    setCategory('');
    setPage(1);
    setSortBy('createdAt');
    setSortOrder('desc');
  };

  const handleJumpToPage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const target = parseInt(jumpToPageInput, 10);
    if (!isNaN(target) && target >= 1 && target <= totalPages) {
      setPage(target);
    }
    setJumpToPageInput('');
  };

  const handleRowClick = (asset: AssetWithRelations) => {
    setSelectedAsset(asset);
    setCreateMode(false);
    setDetailModalOpen(true);
  };

  const handleCreateClick = () => {
    setSelectedAsset(null);
    setCreateMode(true);
    setDetailModalOpen(true);
  };

  const isSuperadminDeck = user.role === 'SUPERADMIN' && branchId === '' && search === '';

  const handleExportExcel = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const result = await getAssetsForExport(branchId ? Number(branchId) : undefined);
      if (!result.success || !result.assets) {
        alert(result.error || 'Gagal mengambil data untuk export.');
        return;
      }

      const workbook = XLSX.utils.book_new();
      const columns = (items: AssetWithRelations[]) => items.map((asset, index) => ({
        No: index + 1,
        'Kode Aset (Asset Tag)': asset.assetTag || '-',
        'Nama Barang': asset.name,
        'Serial Number (S/N)': asset.serialNumber || '-',
        'User (PIC)': asset.pic || '-',
        Kategori: asset.category,
        'Lokasi Detail': asset.locationDetail || '-',
        'Kondisi / Status': asset.status,
        'Status Label': asset.labelStatus || 'BELUM',
        'Harga Beli (Rp)': asset.price != null ? Number(asset.price) : null,
      }));

      const safeSheetName = (name: string, usedNames: Set<string>) => {
        const baseName = (name || 'Cabang').replace(/[\\/*?:\[\]]/g, '-').slice(0, 31) || 'Cabang';
        let sheetName = baseName;
        let suffix = 1;
        while (usedNames.has(sheetName)) {
          const suffixText = `-${suffix++}`;
          sheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
        }
        usedNames.add(sheetName);
        return sheetName;
      };

      if (isSuperadminDeck) {
        const groupedAssets = new Map<string, AssetWithRelations[]>();
        for (const asset of result.assets) {
          const groupKey = asset.branch?.code || asset.branch?.name || 'Cabang';
          const group = groupedAssets.get(groupKey) || [];
          group.push(asset);
          groupedAssets.set(groupKey, group);
        }

        const usedSheetNames = new Set<string>();
        for (const [groupName, group] of groupedAssets) {
          const worksheet = XLSX.utils.json_to_sheet(columns(group));
          XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(groupName, usedSheetNames));
        }

        if (workbook.SheetNames.length === 0) {
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'Inventaris');
        }
        XLSX.writeFile(workbook, 'Inventaris_Semua_Cabang.xlsx');
      } else {
        const worksheet = XLSX.utils.json_to_sheet(columns(result.assets));
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventaris');
        const selectedBranch = branchId
          ? branches.find(branch => branch.id === Number(branchId))
          : result.assets[0]?.branch;
        const branchName = selectedBranch?.code || selectedBranch?.name || 'Semua_Cabang';
        const safeFileName = branchName.replace(/[\\/:*?"<>|]/g, '_');
        XLSX.writeFile(workbook, `Inventaris_${safeFileName}.xlsx`);
      }
    } catch (error) {
      console.error('Export Excel error:', error);
      alert('Gagal membuat file Export Excel.');
    } finally {
      setExporting(false);
    }
  };

  const handleToggleLabel = async (e: React.MouseEvent, asset: AssetWithRelations) => {
    e.stopPropagation();
    if (user.role === 'VIEWER' || togglingLabelId === asset.id) return;

    setTogglingLabelId(asset.id);
    try {
      const res = await toggleAssetLabelStatus(asset.id);

      if (res.success) {
        setRefreshTrigger(prev => prev + 1);
      } else {
        alert(res.error || 'Gagal mengubah status label aset.');
      }
    } catch (err) {
      console.error('Failed to toggle label status:', err);
      alert('Gagal mengubah status label aset.');
    } finally {
      setTogglingLabelId(null);
    }
  };

  const getStatusBadge = (assetStatus: AssetStatus) => {
    switch (assetStatus) {
      case 'AKTIF':
        return (
          <span style={{
            backgroundColor: '#16a34a',
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: '4px',
            display: 'inline-block'
          }}>
            Baik
          </span>
        );
      case 'RUSAK':
        return (
          <span style={{
            backgroundColor: '#dc2626',
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: '4px',
            display: 'inline-block'
          }}>
            Rusak
          </span>
        );
      case 'DIPERBAIKI':
        return (
          <span style={{
            backgroundColor: '#2563eb',
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: '4px',
            display: 'inline-block'
          }}>
            Servis
          </span>
        );
      case 'HILANG':
        return (
          <span style={{
            backgroundColor: '#64748b',
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: '4px',
            display: 'inline-block'
          }}>
            Hilang
          </span>
        );
      default:
        return <span className={styles.statusBadge}>{assetStatus}</span>;
    }
  };

  const renderLabelCell = (asset: AssetWithRelations) => {
    const isLabeled = asset.labelStatus?.toUpperCase() === 'SUDAH';
    const isLoading = togglingLabelId === asset.id;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
        <span style={{
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 700,
          backgroundColor: isLabeled ? '#16a34a' : '#475569',
          color: '#ffffff',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <Tag size={12} />
          {isLabeled ? 'Sudah' : 'Belum'}
        </span>
        
        {user.role !== 'VIEWER' && (
          <button
            type="button"
            disabled={isLoading}
            onClick={(e) => handleToggleLabel(e, asset)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: '11px',
              fontWeight: 600,
              color: isLabeled ? '#eab308' : '#16a34a',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              marginTop: '2px',
              opacity: isLoading ? 0.6 : 1
            }}
          >
            {isLabeled ? (
              <>
                <X size={12} /> {isLoading ? 'Proses...' : 'Reset'}
              </>
            ) : (
              <>
                <Check size={12} /> {isLoading ? 'Proses...' : 'Tandai'}
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  const totalAssetsSum = branchStats?.reduce((acc, curr) => acc + curr.totalCount, 0) || 0;
  const totalAktifSum = branchStats?.reduce((acc, curr) => acc + curr.aktifCount, 0) || 0;
  const totalRusakSum = branchStats?.reduce((acc, curr) => acc + curr.rusakCount, 0) || 0;
  const totalServisSum = branchStats?.reduce((acc, curr) => acc + curr.diperbaikiCount, 0) || 0;
  const totalHilangSum = branchStats?.reduce((acc, curr) => acc + curr.hilangCount, 0) || 0;

  const pct = (val: number) => totalAssetsSum > 0 ? (val / totalAssetsSum) * 100 : 0;

  const handleBranchCardClick = (id: number) => {
    setBranchId(String(id));
    setPage(1);
  };

  const headerThStyle: React.CSSProperties = {
    backgroundColor: '#343a40',
    color: '#ffffff',
    padding: '14px 12px',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    border: 'none'
  };

  return (
    <div className={styles.container} style={{ maxWidth: '100%', padding: '0 12px' }}>
      <style jsx>{`
        .iac-search-input:focus {
          border-color: #2563eb !important;
          background-color: #ffffff !important;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
        }
        .iac-btn-import:hover {
          background-color: #f8fafc !important;
          border-color: #94a3b8 !important;
        }
        .iac-btn-export:hover {
          background-color: #15803d !important;
          transform: translateY(-1px);
        }
        .iac-btn-add:hover {
          filter: brightness(1.08);
          transform: translateY(-1px);
        }
        .iac-back-btn:hover {
          background-color: #eef2ff !important;
          border-color: #a5b4fc !important;
        }
        .iac-filter-toggle:hover {
          background-color: #f1f5f9 !important;
        }
        .iac-reset-btn:hover {
          background-color: #fef2f2 !important;
          border-color: #fecaca !important;
          color: #dc2626 !important;
        }
        .iac-kpi-card {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .iac-kpi-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 16px 30px -14px rgba(15, 23, 42, 0.3) !important;
        }
        .iac-kpi-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        @media (max-width: 900px) {
          .iac-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 520px) {
          .iac-kpi-grid {
            grid-template-columns: 1fr;
          }
        }
        .iac-overview-grid {
          grid-template-columns: minmax(340px, 1fr) minmax(420px, 1.25fr);
        }
        @media (max-width: 1024px) {
          .iac-overview-grid {
            grid-template-columns: 1fr;
          }
        }
        .iac-branch-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--space-4);
          margin-top: var(--space-4);
        }
        @media (max-width: 1100px) {
          .iac-branch-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 640px) {
          .iac-branch-grid {
            grid-template-columns: 1fr;
          }
        }
        .iac-branch-card {
          transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
        }
        .iac-branch-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 22px 40px -18px rgba(15, 23, 42, 0.28) !important;
        }
        .iac-branch-card:hover .iac-branch-detail-pill {
          background-color: var(--pill-hover-bg) !important;
          color: #ffffff !important;
        }
        .iac-branch-stat-item {
          transition: transform 0.15s ease;
        }
        .iac-branch-card:hover .iac-branch-stat-item {
          transform: translateY(-1px);
        }
      `}</style>

      <header
        className={styles.headerRow}
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
          marginBottom: '20px',
          paddingBottom: '20px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #1e293b, #334155)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 10px -2px rgba(30,41,59,0.35)'
          }}>
            <Building2 size={22} color="#ffffff" />
          </div>
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 800, margin: 0, color: '#0f172a' }}>Inventaris & Aset</h2>
            <p className="text-muted" style={{ margin: '4px 0 0 0' }}>
              {isSuperadminDeck 
                ? 'Ringkasan inventaris dan aset operasional di seluruh cabang.'
                : 'Mencatat, melacak, dan mengalokasikan aset operasional General Affairs.'}
            </p>
          </div>
        </div>
        {user.role !== 'VIEWER' && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="btn btn-secondary iac-btn-import"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                minHeight: '44px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#334155',
                fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              <Upload size={18} />
              <span>Import Aset</span>
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting}
              className="iac-btn-export"
              style={{
                backgroundColor: '#16a34a',
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                minHeight: '44px',
                fontWeight: 600,
                border: 'none',
                borderRadius: '10px',
                padding: '0 18px',
                cursor: exporting ? 'not-allowed' : 'pointer',
                opacity: exporting ? 0.7 : 1,
                boxShadow: '0 4px 10px -2px rgba(22,163,74,0.4)',
                transition: 'all 0.15s ease',
              }}
            >
              <Download size={18} />
              <span>{exporting ? 'Mengunduh...' : 'Export Excel'}</span>
            </button>
            <button
              type="button"
              onClick={handleCreateClick}
              className="btn btn-primary iac-btn-add"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                minHeight: '44px',
                borderRadius: '10px',
                fontWeight: 600,
                boxShadow: '0 4px 10px -2px rgba(37,99,235,0.4)',
                transition: 'all 0.15s ease',
              }}
            >
              <Plus size={18} />
              <span>Tambah Aset</span>
            </button>
          </div>
        )}
      </header>

      {isSuperadminDeck ? (
        <>
          <section
            style={{
              display: 'grid',
              gap: 'var(--space-4)',
              marginBottom: 'var(--space-2)',
              alignItems: 'stretch',
            }}
            className={`${styles.overviewGrid} iac-overview-grid`}
          >
            <div className="iac-kpi-grid" style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <KpiCard
                icon={<Building2 size={20} />}
                label="Total Semua Aset"
                value={totalAssetsSum}
                percentOfTotal={100}
                barColor="#4f46e5"
                iconBg="linear-gradient(135deg, #4f46e5, #6366f1)"
                valueColor="#312e81"
                caption="Seluruh aset di semua cabang"
              />
              <KpiCard
                icon={<CheckCircle2 size={20} />}
                label="Aktif / Bagus"
                value={totalAktifSum}
                percentOfTotal={pct(totalAktifSum)}
                barColor="#10b981"
                iconBg="linear-gradient(135deg, #059669, #10b981)"
                valueColor="#065f46"
                caption="Kondisi baik & siap pakai"
              />
              <KpiCard
                icon={<Wrench size={20} />}
                label="Dalam Servis"
                value={totalServisSum}
                percentOfTotal={pct(totalServisSum)}
                barColor="#3b82f6"
                iconBg="linear-gradient(135deg, #2563eb, #3b82f6)"
                valueColor="#1e3a8a"
                caption="Sedang dalam perbaikan"
              />
              <KpiCard
                icon={<AlertTriangle size={20} />}
                label="Rusak / Rusak Berat"
                value={totalRusakSum}
                percentOfTotal={pct(totalRusakSum)}
                barColor="#f97316"
                iconBg="linear-gradient(135deg, #ea580c, #f97316)"
                valueColor="#9a3412"
                caption="Perlu tindak lanjut segera"
              />
              <KpiCard
                icon={<HelpCircle size={20} />}
                label="Aset Hilang"
                value={totalHilangSum}
                percentOfTotal={pct(totalHilangSum)}
                barColor="#8b5cf6"
                iconBg="linear-gradient(135deg, #7c3aed, #a78bfa)"
                valueColor="#5b21b6"
                caption="Belum ditemukan / dilacak"
              />
            </div>

            <div style={{
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 'var(--space-4)',
              borderRadius: 20,
              background: 'linear-gradient(160deg, #ffffff 0%, #f8fafc 100%)',
              border: '1px solid #e2e8f0',
              boxShadow: '0 14px 32px -16px rgba(15, 23, 42, 0.22)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  flexShrink: 0,
                  boxShadow: '0 6px 14px -6px rgba(99, 102, 241, 0.6)',
                }}>
                  <PieChart size={18} />
                </div>
                <div>
                  <p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                    Grafik Kategori Aset
                  </p>
                  <p style={{ fontSize: 'var(--text-xs)', margin: '2px 0 0 0', color: '#94a3b8' }}>
                    Distribusi aset berdasarkan kategori
                  </p>
                </div>
              </div>
              {categoryStatsLoading && categoryAssets.length === 0 ? (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
                  Memuat data kategori...
                </p>
              ) : (
                <CategoryDonutChart
                  slices={categorySlices}
                  totalValue={categoryAssets.length}
                />
              )}
            </div>
          </section>

          <section className="iac-branch-grid">
            {branchStats.map((b, idx) => {
              const accent = BRANCH_ACCENTS[idx % BRANCH_ACCENTS.length];
              const statConfigs = [
                { label: 'Aktif', value: b.aktifCount, icon: CheckCircle2, color: '#16a34a', bg: '#f0fdf4' },
                { label: 'Servis', value: b.diperbaikiCount, icon: Wrench, color: '#2563eb', bg: '#eff6ff' },
                { label: 'Rusak', value: b.rusakCount, icon: AlertTriangle, color: '#ea580c', bg: '#fff7ed' },
                { label: 'Hilang', value: b.hilangCount, icon: HelpCircle, color: '#7c3aed', bg: '#f5f3ff' },
              ];

              return (
                <div
                  key={b.branchId}
                  className="iac-branch-card"
                  onClick={() => handleBranchCardClick(b.branchId)}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: '#ffffff',
                    borderRadius: 20,
                    border: '1px solid #eef1f6',
                    boxShadow: '0 10px 26px -18px rgba(15, 23, 42, 0.3)',
                    padding: 'var(--space-5)',
                    display: 'flex',
                    flexDirection: 'column',
                    '--pill-hover-bg': accent.solid,
                  } as React.CSSProperties}
                >
                  {/* top accent bar */}
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 4,
                    background: `linear-gradient(90deg, ${accent.solid}, ${accent.solid}55)`,
                  }} />

                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
                      <div style={{
                        width: 46,
                        height: 46,
                        borderRadius: 13,
                        flexShrink: 0,
                        background: `linear-gradient(135deg, ${accent.solid}, ${accent.solid}cc)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: `0 8px 16px -8px ${accent.solid}88`,
                      }}>
                        <Building2 size={22} color="#ffffff" />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{
                          fontSize: '15px',
                          fontWeight: 800,
                          color: '#0f172a',
                          margin: 0,
                          lineHeight: 1.3,
                        }}>
                          {b.name}
                        </h3>
                        <p style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 600, margin: '2px 0 0 0' }}>
                          Cabang &middot; {b.totalCount} aset tercatat
                        </p>
                      </div>
                    </div>
                    <span style={{
                      flexShrink: 0,
                      fontSize: '11px',
                      fontWeight: 800,
                      letterSpacing: '0.3px',
                      color: accent.text,
                      backgroundColor: accent.soft,
                      padding: '5px 10px',
                      borderRadius: 999,
                    }}>
                      {b.code}
                    </span>
                  </div>

                  <div style={{
                    marginTop: 'var(--space-4)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '10px',
                    position: 'relative',
                    zIndex: 1,
                  }}>
                    {statConfigs.map((stat) => {
                      const StatIcon = stat.icon;
                      return (
                        <div
                          key={stat.label}
                          className="iac-branch-stat-item"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 12px',
                            borderRadius: 14,
                            backgroundColor: stat.bg,
                          }}
                        >
                          <div style={{
                            width: 30,
                            height: 30,
                            borderRadius: 9,
                            flexShrink: 0,
                            backgroundColor: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: stat.color,
                            boxShadow: '0 2px 6px -2px rgba(15,23,42,0.18)',
                          }}>
                            <StatIcon size={15} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
                              {stat.value}
                            </div>
                            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                              {stat.label}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 'var(--space-4)', position: 'relative', zIndex: 1 }}>
                    <MiniStackedBar
                      aktif={b.aktifCount}
                      servis={b.diperbaikiCount}
                      rusak={b.rusakCount}
                      hilang={b.hilangCount}
                    />
                  </div>

                  <div style={{
                    marginTop: 'var(--space-4)',
                    paddingTop: 'var(--space-3)',
                    borderTop: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    position: 'relative',
                    zIndex: 1,
                  }}>
                    <span style={{ fontSize: '12.5px', color: '#64748b', fontWeight: 600 }}>
                      Total: <b style={{ color: '#0f172a' }}>{b.totalCount} Aset</b>
                    </span>
                    <span
                      className="iac-branch-detail-pill"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: accent.text,
                        backgroundColor: accent.soft,
                        padding: '6px 12px',
                        borderRadius: 999,
                        transition: 'background-color 0.2s ease, color 0.2s ease',
                      }}
                    >
                      Detail Aset
                      <ChevronRight size={14} />
                    </span>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      ) : (
        <>
          {user.role === 'SUPERADMIN' && (branchId !== '' || search !== '') && (
            <div
              className={styles.backButtonRow}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                marginBottom: '4px',
              }}
            >
              <button 
                type="button" 
                onClick={handleResetFilters} 
                className={`${styles.backBtn} iac-back-btn`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '9px 16px',
                  borderRadius: '999px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: '13px',
                  boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
                  transition: 'all 0.15s ease',
                }}
              >
                <ArrowLeft size={16} />
                <span>Kembali ke Semua Cabang</span>
              </button>

              {branchId !== '' ? (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '999px',
                  backgroundColor: '#eef2ff',
                  color: '#4338ca',
                  fontSize: '12px',
                  fontWeight: 600,
                }}>
                  <Building2 size={13} />
                  Cabang: {branches.find(b => String(b.id) === branchId)?.name || '-'}
                </span>
              ) : search !== '' ? (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '999px',
                  backgroundColor: '#f0fdf4',
                  color: '#15803d',
                  fontSize: '12px',
                  fontWeight: 600,
                }}>
                  <Search size={13} />
                  Pencarian: &ldquo;{search}&rdquo;
                </span>
              ) : null}
            </div>
          )}

          <section
            className={styles.filterCard}
            style={{
              width: '100%',
              marginBottom: '16px',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
              padding: '16px',
              backgroundColor: '#ffffff',
            }}
          >
            <div className={styles.toolbarRow} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div className={styles.searchWrapper} style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                <input
                  type="text"
                  className={`${styles.searchInput} iac-search-input`}
                  placeholder="Cari nama aset, kode, serial number, lokasi, atau PIC..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '11px 14px 11px 42px',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    fontSize: '14px',
                    color: '#0f172a',
                    outline: 'none',
                    transition: 'all 0.15s ease',
                  }}
                />
              </div>

              <div className={styles.actionButtons} style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowAdvancedFilters(prev => !prev)}
                  className={`${styles.toggleBtn} ${showAdvancedFilters ? styles.toggleActive : ''} iac-filter-toggle`}
                  title="Tampilkan Penyaringan Lanjutan"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 16px',
                    borderRadius: '10px',
                    border: showAdvancedFilters ? '1px solid #2563eb' : '1px solid #e2e8f0',
                    backgroundColor: showAdvancedFilters ? '#eff6ff' : '#ffffff',
                    color: showAdvancedFilters ? '#1d4ed8' : '#334155',
                    fontWeight: 600,
                    fontSize: '13px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Filter size={16} />
                  <span>Filter Lanjutan</span>
                  {activeFiltersCount > 0 && (
                    <span
                      className={styles.badge}
                      style={{
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        minWidth: '18px',
                        height: '18px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 4px',
                      }}
                    >
                      {activeFiltersCount}
                    </span>
                  )}
                </button>

                {(search || activeFiltersCount > 0) && (
                  <button 
                    type="button" 
                    onClick={handleResetFilters} 
                    className={`${styles.resetBtn} iac-reset-btn`}
                    title="Reset Semua Filter"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '10px 16px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      backgroundColor: '#ffffff',
                      color: '#64748b',
                      fontWeight: 600,
                      fontSize: '13px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <X size={14} />
                    <span>Reset Filter</span>
                  </button>
                )}
              </div>
            </div>

            {showAdvancedFilters && (
              <div
                className={styles.advancedPanel}
                style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px dashed #e2e8f0' }}
              >
                <div
                  className={styles.advancedGrid}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}
                >
                  {user.role === 'SUPERADMIN' ? (
                    <div className={styles.filterGroup}>
                      <label htmlFor="branch-filter" className={styles.label} style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px', display: 'block' }}>Cabang</label>
                      <select
                        id="branch-filter"
                        className={styles.input}
                        value={branchId}
                        onChange={(e) => handleFilterChange(setBranchId, e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', fontSize: '13px', color: '#0f172a' }}
                      >
                        <option value="">Semua Cabang</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className={styles.filterGroup}>
                      <label className={styles.label} style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px', display: 'block' }}>Cabang Terkunci</label>
                      <input
                        type="text"
                        className={styles.input}
                        value={user.branchId ? branches.find(b => b.id === user.branchId)?.name || 'Cabang Terdaftar' : '-'}
                        disabled
                        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', backgroundColor: '#f1f5f9', fontSize: '13px', color: '#64748b' }}
                      />
                    </div>
                  )}

                  <div className={styles.filterGroup}>
                    <label htmlFor="status-filter" className={styles.label} style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px', display: 'block' }}>Kondisi / Status</label>
                    <select
                      id="status-filter"
                      className={styles.input}
                      value={status}
                      onChange={(e) => handleFilterChange(setStatus, e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', fontSize: '13px', color: '#0f172a' }}
                    >
                      <option value="">Semua Kondisi</option>
                      <option value="AKTIF">Aktif (Baik)</option>
                      <option value="RUSAK">Rusak</option>
                      <option value="DIPERBAIKI">Dalam Servis</option>
                      <option value="HILANG">Hilang</option>
                    </select>
                  </div>

                  <div className={styles.filterGroup}>
                    <label htmlFor="category-filter" className={styles.label} style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px', display: 'block' }}>Kategori</label>
                    <select
                      id="category-filter"
                      className={styles.input}
                      value={category}
                      onChange={(e) => handleFilterChange(setCategory, e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', fontSize: '13px', color: '#0f172a' }}
                    >
                      <option value="">Semua Kategori</option>
                      {EXTENDED_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={styles.tableCard} style={{ width: '100%', padding: '16px' }}>
            {loading ? (
              <div className={styles.loadingCover}>
                <div className={styles.spinner}></div>
              </div>
            ) : error ? (
              <div className={styles.emptyState}>
                <p style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{error}</p>
                <button 
                  type="button" 
                  onClick={() => setRefreshTrigger(prev => prev + 1)}
                  className="btn btn-secondary"
                  style={{ marginTop: 'var(--space-2)', minHeight: '38px' }}
                >
                  Coba Lagi
                </button>
              </div>
            ) : assets.length === 0 ? (
              <div className={styles.emptyState}>
                <HelpCircle size={48} style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)', opacity: 0.5 }} />
                <h3>Tidak Ada Data Aset</h3>
                <p className="text-muted" style={{ maxWidth: '400px', margin: '0 auto var(--space-4) auto' }}>
                  Tidak ditemukan inventaris yang sesuai dengan filter atau pencarian Anda.
                </p>
                {user.role !== 'VIEWER' && (
                  <button 
                    type="button" 
                    onClick={handleCreateClick}
                    className="btn btn-primary"
                    style={{ minHeight: '44px' }}
                  >
                    Mulai Catat Baru
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className={styles.tableResponsive}>
                  <table 
                    style={{ 
                      width: '100%', 
                      borderCollapse: 'separate', 
                      borderSpacing: '0 8px' 
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={{ ...headerThStyle, width: '45px', textAlign: 'center', borderTopLeftRadius: '8px', borderBottomLeftRadius: '8px' }}>NO</th>
                        <th style={{ ...headerThStyle, cursor: 'pointer' }} onClick={() => handleSort('assetTag')}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>KODE</span>
                            <ArrowUpDown size={12} />
                          </div>
                        </th>
                        <th style={{ ...headerThStyle, cursor: 'pointer' }} onClick={() => handleSort('name')}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>NAMA BARANG (S/N)</span>
                            <ArrowUpDown size={12} />
                          </div>
                        </th>
                        <th style={{ ...headerThStyle }}>USER (PIC)</th>
                        <th style={{ ...headerThStyle, cursor: 'pointer' }} onClick={() => handleSort('price')}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>HARGA</span>
                            <ArrowUpDown size={12} />
                          </div>
                        </th>
                        <th style={{ ...headerThStyle, cursor: 'pointer' }} onClick={() => handleSort('category')}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>KATEGORI</span>
                            <ArrowUpDown size={12} />
                          </div>
                        </th>
                        <th style={{ ...headerThStyle }}>LOKASI</th>
                        <th style={{ ...headerThStyle, cursor: 'pointer', width: '90px' }} onClick={() => handleSort('status')}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>KONDISI</span>
                            <ArrowUpDown size={12} />
                          </div>
                        </th>
                        <th style={{ ...headerThStyle, width: '95px' }}>LABEL</th>
                        {user.role === 'SUPERADMIN' && (
                          <th style={{ ...headerThStyle, cursor: 'pointer' }} onClick={() => handleSort('branchId')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>CABANG</span>
                              <ArrowUpDown size={12} />
                            </div>
                          </th>
                        )}
                        <th style={{ ...headerThStyle, textAlign: 'center', width: '130px', borderTopRightRadius: '8px', borderBottomRightRadius: '8px' }}>AKSI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.map((asset, idx) => {
                        const rowNum = (page - 1) * 10 + idx + 1;
                        const cellStyle: React.CSSProperties = {
                          backgroundColor: '#f8fafc',
                          padding: '12px 14px',
                          verticalAlign: 'middle',
                          fontSize: '13px',
                          borderTop: '1px solid #e2e8f0',
                          borderBottom: '1px solid #e2e8f0'
                        };

                        return (
                          <tr 
                            key={asset.id} 
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleRowClick(asset)}
                          >
                            <td style={{ 
                              ...cellStyle, 
                              textAlign: 'center', 
                              fontWeight: 600, 
                              color: '#64748b',
                              borderLeft: '1px solid #e2e8f0',
                              borderTopLeftRadius: '8px',
                              borderBottomLeftRadius: '8px'
                            }}>
                              {rowNum}
                            </td>

                            <td style={{ ...cellStyle, fontWeight: 700, color: '#0f172a' }}>
                              {getDisplayAssetTag(asset, idx)}
                            </td>

                            <td style={{ ...cellStyle }}>
                              <div style={{ fontWeight: 700, color: '#1e293b' }}>{asset.name}</div>
                              {asset.serialNumber ? (
                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                  SN: {asset.serialNumber}
                                </div>
                              ) : (
                                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                                  SN: -
                                </div>
                              )}
                            </td>

                            <td style={{ ...cellStyle }}>
                              {asset.pic ? (
                                <span style={{ fontWeight: 500, color: '#334155' }}>{asset.pic}</span>
                              ) : (
                                <span style={{ fontStyle: 'italic', color: '#94a3b8', fontSize: '12px' }}>Belum ada user</span>
                              )}
                            </td>

                            <td style={{ ...cellStyle }}>
                              {asset.price ? (
                                <div>
                                  <span style={{ color: '#64748b', fontSize: '11px', display: 'block' }}>Beli:</span>
                                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{formatRupiah(asset.price)}</span>
                                </div>
                              ) : (
                                '-'
                              )}
                            </td>

                            <td style={{ ...cellStyle, color: '#334155', fontWeight: 500 }}>
                              {asset.category}
                            </td>

                            <td style={{ ...cellStyle, color: '#334155' }}>
                              {asset.locationDetail || '-'}
                            </td>

                            <td style={{ ...cellStyle }}>
                              {getStatusBadge(asset.status)}
                            </td>

                            <td style={{ ...cellStyle }}>
                              {renderLabelCell(asset)}
                            </td>

                            {user.role === 'SUPERADMIN' && (
                              <td style={{ ...cellStyle, color: '#475569', fontSize: '12px' }}>
                                {asset.branch?.name || '-'}
                              </td>
                            )}

                            <td style={{ 
                              ...cellStyle, 
                              textAlign: 'center',
                              borderRight: '1px solid #e2e8f0',
                              borderTopRightRadius: '8px',
                              borderBottomRightRadius: '8px'
                            }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  title="Lihat / Edit Detail"
                                  onClick={() => handleRowClick(asset)}
                                  style={{
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '8px',
                                    padding: '8px',
                                    backgroundColor: '#ffffff',
                                    cursor: 'pointer',
                                    color: '#475569',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                >
                                  <Eye size={16} />
                                </button>

                                <button
                                  type="button"
                                  title="Serah Terima Aset"
                                  onClick={() => handleRowClick(asset)}
                                  style={{
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '8px',
                                    backgroundColor: '#00b87c',
                                    cursor: 'pointer',
                                    color: '#ffffff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                >
                                  <Handshake size={16} />
                                </button>

                                <button
                                  type="button"
                                  title="Lihat / Cetak QR Code"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedAsset(asset);
                                    setQrLabelModalOpen(true);
                                  }}
                                  style={{
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '8px',
                                    backgroundColor: '#64748b',
                                    cursor: 'pointer',
                                    color: '#ffffff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                >
                                  <QrCode size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className={styles.paginationRow} style={{ marginTop: '16px', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                  <div className={styles.paginationInfo}>
                    Menampilkan <b>{Math.min(totalCount, (page - 1) * 10 + 1)}</b> hingga <b>{Math.min(totalCount, page * 10)}</b> dari <b>{totalCount}</b> aset
                    {totalPages > 0 && (
                      <span style={{ marginLeft: 6, color: '#94a3b8' }}>
                        (Halaman {page} dari {totalPages})
                      </span>
                    )}
                  </div>
                  <div className={styles.paginationActions} style={{ flexWrap: 'wrap', rowGap: 8 }}>
                    <button
                      type="button"
                      className={`${styles.navBtn} ${page === 1 ? styles.btnDisabled : ''}`}
                      onClick={() => page > 1 && setPage(1)}
                      disabled={page === 1}
                      title="Halaman pertama"
                    >
                      <ChevronsLeft size={16} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.navBtn} ${page === 1 ? styles.btnDisabled : ''}`}
                      onClick={() => page > 1 && setPage(page - 1)}
                      disabled={page === 1}
                    >
                      <ChevronLeft size={16} />
                      <span>Sebelumnya</span>
                    </button>

                    {getPaginationRange(page, totalPages, 1).map((p, idx) => (
                      p === 'dots' ? (
                        <span
                          key={`dots-${idx}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'flex-end',
                            justifyContent: 'center',
                            width: 32,
                            height: 32,
                            color: '#94a3b8',
                            fontWeight: 700,
                            paddingBottom: 4,
                            userSelect: 'none',
                          }}
                        >
                          &hellip;
                        </span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          className={`${styles.pageBtn} ${page === p ? styles.btnActive : ''}`}
                          onClick={() => setPage(p)}
                        >
                          {p}
                        </button>
                      )
                    ))}

                    <button
                      type="button"
                      className={`${styles.navBtn} ${page === totalPages ? styles.btnDisabled : ''}`}
                      onClick={() => page < totalPages && setPage(page + 1)}
                      disabled={page === totalPages}
                    >
                      <span>Berikutnya</span>
                      <ChevronRight size={16} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.navBtn} ${page === totalPages ? styles.btnDisabled : ''}`}
                      onClick={() => page < totalPages && setPage(totalPages)}
                      disabled={page === totalPages}
                      title="Halaman terakhir"
                    >
                      <ChevronsRight size={16} />
                    </button>

                    {totalPages > 9 && (
                      <form
                        onSubmit={handleJumpToPage}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}
                      >
                        <span style={{ fontSize: 'var(--text-xs)', color: '#64748b', whiteSpace: 'nowrap' }}>
                          Ke halaman
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={totalPages}
                          value={jumpToPageInput}
                          onChange={(e) => setJumpToPageInput(e.target.value)}
                          placeholder={String(page)}
                          style={{
                            width: 64,
                            padding: '6px 8px',
                            borderRadius: 8,
                            border: '1px solid #e2e8f0',
                            fontSize: 'var(--text-xs)',
                            textAlign: 'center',
                          }}
                        />
                        <button
                          type="submit"
                          className={styles.navBtn}
                          style={{ padding: '6px 12px' }}
                        >
                          Ke
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {detailModalOpen && (
        <AssetDetailModal
          isOpen={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          asset={selectedAsset}
          user={user}
          branches={branches}
          createMode={createMode}
          onSaveSuccess={() => {
            setDetailModalOpen(false);
            setRefreshTrigger(prev => prev + 1);
          }}
        />
      )}

      {importModalOpen && (
        <AssetImportModal
          isOpen={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          user={user}
          branches={branches}
          onImportSuccess={() => {
            setImportModalOpen(false);
            setRefreshTrigger(prev => prev + 1);
          }}
        />
      )}

      {qrLabelModalOpen && (
        <QrLabelModal
          isOpen={qrLabelModalOpen}
          onClose={() => setQrLabelModalOpen(false)}
          asset={selectedAsset}
        />
      )}
    </div>
  );
}