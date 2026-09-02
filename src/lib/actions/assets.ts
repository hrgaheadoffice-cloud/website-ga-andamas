'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/actions/auth';
import { createAuditLog } from '@/lib/actions/audit';
import type { AssetFormData, ApiResponse } from '@/types';
import { normalizeAssetCategory } from '@/types';
import { AssetStatus, Prisma } from '@prisma/client';
import { parseCSV } from '@/lib/csv';

export interface AssetWithRelations {
  id: number;
  branchId: number;
  userId: number;
  assetTag: string | null;
  name: string;
  category: string;
  price: number | null;
  serialNumber: string | null;
  locationDetail: string | null;
  pic: string | null;
  status: AssetStatus;
  labelStatus: string | null;
  imagePath: string | null;
  notes: string | null;
  purchaseYear: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  branch: {
    name: string;
    code: string;
  };
  user: {
    fullName: string;
  };
}

export interface PaginatedAssets {
  assets: AssetWithRelations[];
  totalCount: number;
  totalPages: number;
}

/**
 * Server Action to get the next running sequence for assetTag generation.
 * Looks at active assets for the same category and branch, then returns max sequence + 1.
 */
export async function getNextAssetSequence(category: string, branchId: number): Promise<number> {
  try {
    const normalizedCategory = normalizeAssetCategory(category);
    if (!normalizedCategory) {
      return 1;
    }

    const assets = await prisma.asset.findMany({
      where: {
        archivedAt: null,
        category: normalizedCategory,
        branchId,
        assetTag: {
          not: null,
        },
      },
      select: {
        assetTag: true,
      },
    });

    let maxSeq = 0;
    for (const asset of assets) {
      const assetTag = asset.assetTag?.trim();
      if (!assetTag) continue;

      const match = assetTag.match(/(\d+)\s*$/);
      if (!match) continue;

      const seq = Number.parseInt(match[1], 10);
      if (Number.isFinite(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }

    return maxSeq + 1;
  } catch (error) {
    console.error('Error fetching next asset sequence:', error);
    return 1;
  }
}

export interface AssetFilters {
  search?: string;
  branchId?: number;
  status?: AssetStatus;
  category?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Server Action to query assets based on search query, status, category, and branch.
 * Enforces branch restrictions based on the user's role.
 */
export async function getAssets(filters: AssetFilters = {}): Promise<ApiResponse<PaginatedAssets>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Sesi Anda telah berakhir. Silakan masuk kembali.' };
    }

    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'desc';

    // 1. Resolve branch isolation constraints
    let branchConstraint: number | undefined = undefined;
    if (user.role !== 'SUPERADMIN') {
      if (!user.branchId) {
        return { success: false, error: 'Cabang asal tidak terdeteksi untuk akun Anda.' };
      }
      branchConstraint = user.branchId;
    } else if (filters.branchId) {
      branchConstraint = filters.branchId;
    }

    // 2. Build where filter clauses
    const whereClause: Prisma.AssetWhereInput = {
      archivedAt: null, // Only return active, non-archived assets
    };

    if (branchConstraint !== undefined) {
      whereClause.branchId = branchConstraint;
    }

    if (filters.status) {
      whereClause.status = filters.status;
    }

    if (filters.category) {
      whereClause.category = filters.category;
    }

    if (filters.search && filters.search.trim() !== '') {
      const searchTerms = filters.search.trim();
      whereClause.OR = [
        { name: { contains: searchTerms, mode: 'insensitive' } },
        { assetTag: { contains: searchTerms, mode: 'insensitive' } },
        { category: { contains: searchTerms, mode: 'insensitive' } },

        { locationDetail: { contains: searchTerms, mode: 'insensitive' } },
        { pic: { contains: searchTerms, mode: 'insensitive' } },
        { notes: { contains: searchTerms, mode: 'insensitive' } },
      ];
    }

    // 3. Query records & total count in parallel
    const [assets, totalCount] = await Promise.all([
      prisma.asset.findMany({
        where: whereClause,
        include: {
          branch: { select: { name: true, code: true } },
          user: { select: { fullName: true } },
        },
        orderBy: {
          [sortBy]: sortOrder,
        },
        skip,
        take: limit,
      }),
      prisma.asset.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return {
      success: true,
      data: {
        assets: JSON.parse(JSON.stringify(assets)) as AssetWithRelations[],
        totalCount,
        totalPages,
      },
    };
  } catch (error) {
    console.error('Error fetching assets:', error);
    return { success: false, error: 'Gagal memuat daftar inventaris dari database.' };
  }
}

export async function getAssetsForExport(branchId?: number) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Sesi Anda telah berakhir. Silakan masuk kembali.' };
    }

    const requestedBranchId = user.role === 'SUPERADMIN' ? branchId : user.branchId || undefined;
    if (user.role !== 'SUPERADMIN' && !requestedBranchId) {
      return { success: false, error: 'Cabang asal tidak terdeteksi untuk akun Anda.' };
    }

    const assets = await prisma.asset.findMany({
      where: {
        archivedAt: null,
        ...(requestedBranchId ? { branchId: requestedBranchId } : {}),
      },
      include: {
        branch: true,
      },
      orderBy: [
        { branchId: 'asc' },
        { id: 'asc' },
      ],
    });

    return {
      success: true,
      assets: JSON.parse(JSON.stringify(assets)),
    };
  } catch (error) {
    console.error('Export fetch error:', error);
    return { success: false, error: 'Gagal mengambil data untuk export' };
  }
}

/**
 * Server Action to register a new asset.
 */
export async function createAsset(data: AssetFormData): Promise<ApiResponse<AssetWithRelations>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Sesi Anda telah berakhir. Silakan masuk kembali.' };
    }

    if (user.role === 'VIEWER') {
      return { success: false, error: 'Akses ditolak: Viewer tidak diizinkan menambah inventaris.' };
    }

    // Determine target Branch ID based on role permissions
    let targetBranchId: number;
    if (user.role === 'SUPERADMIN') {
      if (!data.branchId) {
        return { success: false, error: 'Administrator wajib menentukan cabang penanggung jawab.' };
      }
      targetBranchId = data.branchId;
    } else {
      if (!user.branchId) {
        return { success: false, error: 'Cabang asal tidak terdeteksi untuk akun Anda.' };
      }
      targetBranchId = user.branchId;
    }

    // Validate fields
    if (!data.name.trim()) {
      return { success: false, error: 'Nama aset tidak boleh kosong.' };
    }
    const categoryNormalized = normalizeAssetCategory(data.category);
    if (!categoryNormalized) {
      return { success: false, error: 'Kategori aset tidak valid.' };
    }

    // Validate purchaseYear
    if (data.purchaseYear === undefined || data.purchaseYear === null) {
      return { success: false, error: 'Tahun pembelian wajib diisi.' };
    }
    const currentYear = new Date().getFullYear();
    if (isNaN(data.purchaseYear) || data.purchaseYear < 1900 || data.purchaseYear > currentYear + 5) {
      return { success: false, error: `Tahun pembelian tidak valid (harus antara 1900 dan ${currentYear + 5}).` };
    }

    const price = data.price === undefined || data.price === null ? null : Number(data.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return { success: false, error: 'Harga pembelian harus berupa angka yang valid.' };
    }

    // Check assetTag uniqueness in active assets
    if (data.assetTag && data.assetTag.trim() !== '') {
      const existing = await prisma.asset.findFirst({
        where: {
          assetTag: data.assetTag.trim(),
          archivedAt: null,
        },
      });
      if (existing) {
        return { success: false, error: `Kode Tag Aset '${data.assetTag}' sudah terdaftar.` };
      }
    }

    const newAsset = await prisma.asset.create({
      data: {
        branchId: targetBranchId,
        userId: user.id,
        assetTag: data.assetTag?.trim() || null,
        name: data.name.trim(),

        category: categoryNormalized,
        locationDetail: data.locationDetail?.trim() || null,
        pic: data.pic?.trim() || null,
        status: data.status,
        imagePath: data.imagePath || null,
        notes: data.notes?.trim() || null,
        purchaseYear: data.purchaseYear,
        price,
        serialNumber: data.serialNumber?.trim() || null,
      },
      include: {
        branch: { select: { name: true, code: true } },
        user: { select: { fullName: true } },
      },
    });

    await createAuditLog({
      userId: user.id,
      actionType: 'CREATE',
      targetTable: 'Asset',
      targetId: String(newAsset.id),
      description: `Menambahkan aset baru: ${newAsset.name} (${newAsset.category}) di cabang ${newAsset.branch.name}`,
    });

    revalidatePath('/inventaris');

    return {
      success: true,
      data: JSON.parse(JSON.stringify(newAsset)) as AssetWithRelations,
    };
  } catch (error) {
    console.error('Error creating asset:', error);
    return { success: false, error: 'Terjadi kesalahan sistem saat mendaftarkan aset.' };
  }
}

/**
 * Server Action to update an existing asset.
 */
export async function updateAsset(
  id: number,
  data: AssetFormData
): Promise<ApiResponse<AssetWithRelations>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Sesi Anda telah berakhir. Silakan masuk kembali.' };
    }

    if (user.role === 'VIEWER') {
      return { success: false, error: 'Akses ditolak: Viewer tidak diizinkan mengubah inventaris.' };
    }

    // Fetch existing asset to verify branch permission boundary
    const existingAsset = await prisma.asset.findUnique({
      where: { id },
      include: { branch: true },
    });

    if (!existingAsset || existingAsset.archivedAt) {
      return { success: false, error: 'Aset tidak ditemukan atau sudah diarsipkan.' };
    }

    // Enforce branch safety limits
    if (user.role !== 'SUPERADMIN' && existingAsset.branchId !== user.branchId) {
      return { success: false, error: 'Akses ditolak: Anda tidak memiliki akses untuk mengubah aset cabang lain.' };
    }

    // Validate fields
// SESUDAH (Fix)
if (data.name !== undefined && !data.name.trim()) {
  return { success: false, error: 'Nama aset tidak boleh kosong.' };
}
    const categoryNormalized = normalizeAssetCategory(data.category);
    if (!categoryNormalized) {
      return { success: false, error: 'Kategori aset tidak valid.' };
    }

    // Validate purchaseYear
    if (data.purchaseYear === undefined || data.purchaseYear === null) {
      return { success: false, error: 'Tahun pembelian wajib diisi.' };
    }
    const currentYear = new Date().getFullYear();
    if (isNaN(data.purchaseYear) || data.purchaseYear < 1900 || data.purchaseYear > currentYear + 5) {
      return { success: false, error: `Tahun pembelian tidak valid (harus antara 1900 dan ${currentYear + 5}).` };
    }

    const price = data.price === undefined || data.price === null ? null : Number(data.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return { success: false, error: 'Harga pembelian harus berupa angka yang valid.' };
    }

    // Check assetTag uniqueness if changed
    const newTag = data.assetTag?.trim();
    if (newTag && newTag !== (existingAsset.assetTag || '')) {
      const conflicting = await prisma.asset.findFirst({
        where: {
          assetTag: newTag,
          archivedAt: null,
          id: { not: id },
        },
      });
      if (conflicting) {
        return { success: false, error: `Kode Tag Aset '${newTag}' sudah terdaftar pada aset lain.` };
      }
    }

    // Resolve update branchId
    let updateBranchId = existingAsset.branchId;
    if (user.role === 'SUPERADMIN' && data.branchId) {
      updateBranchId = data.branchId;
    }

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        branchId: updateBranchId,
        assetTag: newTag || null,
        name: data.name.trim(),

        category: categoryNormalized,
        locationDetail: data.locationDetail?.trim() || null,
        pic: data.pic?.trim() || null,
        status: data.status,
        imagePath: data.imagePath || existingAsset.imagePath,
        notes: data.notes?.trim() || null,
        purchaseYear: data.purchaseYear,
        price,
        serialNumber: data.serialNumber?.trim() || null,
      },
      include: {
        branch: { select: { name: true, code: true } },
        user: { select: { fullName: true } },
      },
    });

    await createAuditLog({
      userId: user.id,
      actionType: 'UPDATE',
      targetTable: 'Asset',
      targetId: String(id),
      description: `Mengubah detail aset ${updated.name} (ID: ${id})`,
    });

    revalidatePath('/inventaris');
    revalidatePath('/dashboard');

    return {
      success: true,
      data: JSON.parse(JSON.stringify(updated)) as AssetWithRelations,
    };
  } catch (error) {
    console.error('Error updating asset:', error);
    return { success: false, error: 'Terjadi kesalahan sistem saat memperbarui aset.' };
  }
}

/**
 * Server Action to archive (soft delete) an asset.
 */
/**
 * Server Action to permanently delete an asset (Hard Delete).
 */
export async function archiveAsset(id: number): Promise<ApiResponse<void>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Sesi Anda telah berakhir. Silakan masuk kembali.' };
    }

    if (user.role === 'VIEWER') {
      return { success: false, error: 'Akses ditolak: Viewer tidak diizinkan menghapus inventaris.' };
    }

    const existingAsset = await prisma.asset.findUnique({
      where: { id },
    });

    if (!existingAsset) {
      return { success: false, error: 'Aset tidak ditemukan.' };
    }

    // Enforce branch safety limits
    if (user.role !== 'SUPERADMIN' && existingAsset.branchId !== user.branchId) {
      return { success: false, error: 'Akses ditolak: Anda tidak memiliki akses untuk menghapus aset cabang lain.' };
    }

    // Hard Delete: Menghapus baris data secara permanen dari tabel database
    await prisma.asset.delete({
      where: { id },
    });

    await createAuditLog({
      userId: user.id,
      actionType: 'DELETE',
      targetTable: 'Asset',
      targetId: String(id),
      description: `Menghapus aset ${existingAsset.name} (ID: ${id}) secara permanen`,
    });

    // Invalidate cache untuk halaman inventaris dan dashboard
    revalidatePath('/inventaris');
    revalidatePath('/dashboard');

    return { success: true };
  } catch (error) {
    console.error('Error deleting asset:', error);
    return { success: false, error: 'Terjadi kesalahan sistem saat menghapus aset.' };
  }
}

export async function toggleAssetLabelStatus(id: number) {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id },
      select: { labelStatus: true },
    });

    if (!asset) {
      return { success: false, error: 'Aset tidak ditemukan.' };
    }

    const isLabeled = asset.labelStatus?.toUpperCase() === 'SUDAH';
    const nextStatus = isLabeled ? 'BELUM' : 'SUDAH';

    await prisma.asset.update({
      where: { id },
      data: { labelStatus: nextStatus },
    });

    revalidatePath('/inventaris');
    revalidatePath('/dashboard');

    return { success: true, nextStatus };
  } catch (error) {
    console.error('Error toggling label status:', error);
    return { success: false, error: 'Gagal memperbarui status label.' };
  }
}



export interface CSVImportResult {
  totalRows: number;
  importedCount: number;
  errors: string[];
}

/**
 * Server Action to bulk import assets from a CSV string.
 * Automatically resolves status (case-insensitively with default fallbacks) and maps branch codes/names.
 */
export interface ImportAssetPayload {
  name: string;
  category: string;
  assetTag?: string;
  pic?: string;
  locationDetail?: string;
  status?: string;
  branch?: string;
  notes?: string;
  purchaseYear?: string | number;
  price?: number | null;
  serialNumber?: string;
}

export async function importAssets(payload: ImportAssetPayload[]): Promise<ApiResponse<CSVImportResult>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Sesi Anda telah berakhir. Silakan masuk kembali.' };
    }

    if (user.role === 'VIEWER') {
      return { success: false, error: 'Akses ditolak: Viewer tidak diizinkan mengimpor data.' };
    }

    if (payload.length === 0) {
      return { success: false, error: 'Tidak ada data aset yang valid untuk diimpor.' };
    }

    // Load branches database cache
    const dbBranches = await prisma.branch.findMany();
    const dataRows = payload.filter(row => row.name && row.name.trim() !== '');

    const importErrors: string[] = [];
    const assetsToInsert: Prisma.AssetCreateManyInput[] = [];

    // Pre-query existing active asset tags to avoid N+1 DB operations
    const fileTags = new Set<string>();
    for (const row of dataRows) {
      if (row.assetTag && row.assetTag.trim() !== '') {
        fileTags.add(row.assetTag.trim());
      }
    }

    const dbTags = new Set<string>();
    if (fileTags.size > 0) {
      const existingAssets = await prisma.asset.findMany({
        where: {
          assetTag: { in: Array.from(fileTags), mode: 'insensitive' },
          archivedAt: null,
        },
        select: { assetTag: true },
      });
      existingAssets.forEach(a => {
        if (a.assetTag) dbTags.add(a.assetTag.toLowerCase());
      });
    }

    const seenImportTags = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;

      try {
        // 1. Name Check - Validasi aman untuk tipe data yang tidak terduga
        if (!row.name || typeof row.name !== 'string' || row.name.trim() === '') {
          throw new Error('Nama aset tidak boleh kosong dan harus berupa teks yang valid.');
        }
        const name = row.name.trim();

        // 2. Category Check - Validasi aman untuk tipe data yang tidak terduga
        if (!row.category || typeof row.category !== 'string' || row.category.trim() === '') {
          throw new Error('Kategori aset tidak boleh kosong dan harus berupa teks yang valid.');
        }
        const categoryRaw = row.category.trim();
        const categoryNormalized = normalizeAssetCategory(categoryRaw);
        if (!categoryNormalized) {
          throw new Error(`Kategori '${categoryRaw}' tidak valid.`);
        }

        // 3. Asset Tag Unique Validation
        let assetTag: string | null = null;
        if (row.assetTag && row.assetTag.trim()) {
          assetTag = row.assetTag.trim();
          const normalizedTag = assetTag.toLowerCase();
          if (seenImportTags.has(normalizedTag)) {
            throw new Error(`Kode Tag Aset '${assetTag}' duplikat di dalam file.`);
          }
          if (dbTags.has(normalizedTag)) {
            throw new Error(`Kode Tag Aset '${assetTag}' sudah digunakan di database.`);
          }
          seenImportTags.add(normalizedTag);
        }
        // Store original assetTag format while checking duplicates case-insensitively
        assetTag = assetTag ? assetTag.trim() : null;



        // 5. Location Detail
        const locationDetail = row.locationDetail?.trim() || null;

        // 6. PIC
        const pic = row.pic?.trim() || null;

        // 7. Notes
        const notes = row.notes?.trim() || null;

        // 8. Status Matching Case-insensitively
        let status: AssetStatus = AssetStatus.AKTIF;
        if (row.status) {
          const statusRaw = row.status.trim().toLowerCase();
          if (statusRaw.includes('rusak') || statusRaw === 'broken' || statusRaw === 'damaged') {
            status = AssetStatus.RUSAK;
          } else if (statusRaw.includes('perbaikan') || statusRaw.includes('servis') || statusRaw === 'repair' || statusRaw === 'diperbaiki') {
            status = AssetStatus.DIPERBAIKI;
          } else if (statusRaw.includes('hilang') || statusRaw === 'lost' || statusRaw === 'missing') {
            status = AssetStatus.HILANG;
          } else if (statusRaw.includes('aktif') || statusRaw.includes('good') || statusRaw === 'active' || statusRaw === 'bagus') {
            status = AssetStatus.AKTIF;
          }
        }

        // 9. Branch Isolation check
        let branchIdVal: number;
        if (user.role === 'SUPERADMIN') {
          const branchRaw = row.branch?.trim().toLowerCase() || '';
          const matchedBranch = dbBranches.find(
            b => b.name.toLowerCase() === branchRaw || b.code.toLowerCase() === branchRaw
          );
          if (matchedBranch) {
            branchIdVal = matchedBranch.id;
          } else {
            // Default to Superadmin home branch or the first registered branch
            branchIdVal = user.branchId || dbBranches[0]?.id;
            if (!branchIdVal) {
              throw new Error('Cabang penanggung jawab tidak valid dan tidak ada cabang default.');
            }
          }
        } else {
          // Locked to Data Entry / Admin branch
          if (!user.branchId) {
            throw new Error('Cabang asal tidak terdeteksi untuk akun Anda.');
          }
          branchIdVal = user.branchId;
        }

        // 10. Purchase Year Check - Validasi aman untuk tipe data yang tidak terduga
        let purchaseYear: number;
        if (!row.purchaseYear) {
          throw new Error('Tahun pembelian wajib diisi.');
        }
        
        const parsedYear = typeof row.purchaseYear === 'string' 
          ? parseInt(row.purchaseYear.trim(), 10) 
          : row.purchaseYear;
          
        const currentYear = new Date().getFullYear();
        if (isNaN(parsedYear) || parsedYear < 1900 || parsedYear > currentYear + 5) {
          throw new Error('Tahun pembelian harus berupa angka tahun yang valid (misal: 2024).');
        }
        purchaseYear = parsedYear;

        // 11. Price is optional; preserve zero and reject invalid values.
        const price = row.price === undefined || row.price === null
          ? null
          : Number(row.price);
        if (price !== null && !Number.isFinite(price)) {
          throw new Error('Harga harus berupa angka yang valid.');
        }

        const serialNumber = row.serialNumber?.trim() || null;

        assetsToInsert.push({
          branchId: branchIdVal,
          userId: user.id,
          assetTag: assetTag && assetTag.trim() !== '' ? assetTag : null, // Simpan nilai asli tanpa lowercase
          name,
          category: categoryNormalized,
          locationDetail,
          pic,
          status,
          notes,
          purchaseYear,
          price,
          serialNumber,
          imagePath: null, // Initial import does not carry photo files
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Kesalahan tidak diketahui';
        importErrors.push(`Baris ${rowNum}: ${message}`);
      }
    }

    // If there are errors, fail-fast and return them without database modifications (atomic safety)
    if (importErrors.length > 0) {
      return {
        success: false,
        error: 'Beberapa baris data gagal divalidasi.',
        data: {
          totalRows: dataRows.length,
          importedCount: 0,
          errors: importErrors,
        },
      };
    }

    // Commit records one by one to handle individual failures
    let importedCount = 0;
    // Buat array terpisah untuk mengumpulkan error selama penyimpanan database
    const insertionErrors: string[] = [];

    for (let i = 0; i < assetsToInsert.length; i++) {
      const asset = assetsToInsert[i];
      // The fail-fast check ensures `assetsToInsert` and `dataRows` are aligned.
      // The row number in the original file is `i + 2`.
      const rowNum = i + 2;
      try {
        await prisma.asset.create({ data: asset });
        importedCount++;
      } catch (error) {
        // Log detail error ke terminal server
        console.error(`[Import Error Baris ${rowNum}]:`, error);
        
        let message = 'Kesalahan tak terduga saat menyimpan baris ini.';
        
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            message = `Kode Tag Aset '${asset.assetTag || 'tanpa tag'}' sudah terdaftar di database.`;
          } else if (error.code === 'P2003') {
            message = `Relasi Cabang (branchId: ${asset.branchId}) atau User ID (${asset.userId}) tidak ditemukan di database.`;
          } else {
            message = `Database Error (${error.code}): ${error.message}`;
          }
        } else if (error instanceof Error) {
          message = error.message;
        }
        
        insertionErrors.push(`Baris ${rowNum}: ${message}`);
      }
    }

    // Create audit log if any assets were successfully imported
    if (importedCount > 0) {
      await createAuditLog({
        userId: user.id,
        actionType: 'CREATE',
        targetTable: 'Asset',
        targetId: 'BULK',
        description: `Melakukan impor massal ${importedCount} dari ${assetsToInsert.length} aset dari Excel/CSV`,
      });
    }

    revalidatePath('/inventaris');

    // Gabungkan semua error (validasi awal + error penyimpanan)
    const allErrors = [...importErrors, ...insertionErrors];

    // Jika tidak ada aset yang berhasil diimpor, kembalikan error spesifik
    if (importedCount === 0) {
      return {
        success: false,
        error: "Gagal menyimpan semua baris data ke database.",
        data: {
          totalRows: dataRows.length,
          importedCount: 0,
          errors: allErrors,
        },
      };
    }

    // Jika masih ada error (beberapa baris gagal, tapi sebagian berhasil)
    if (allErrors.length > 0) {
      return {
        success: false,
        error: 'Beberapa baris data gagal disimpan ke database.',
        data: {
          totalRows: dataRows.length,
          importedCount: importedCount,
          errors: allErrors,
        },
      };
    }

    // Jika semua aset berhasil diimpor tanpa error
    return {
      success: true,
      data: {
        totalRows: dataRows.length,
        importedCount: importedCount,
        errors: allErrors,
      },
    };
  } catch (error) {
    console.error('Error importing assets:', error);

    // Handle unique constraint violation specifically
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        success: false,
        error: 'Gagal mengimpor: Terdapat duplikasi Kode Tag Aset. Pastikan kode aset dalam file Anda belum terdaftar di sistem.',
      };
    }
    
    return { success: false, error: 'Terjadi kesalahan internal saat memproses impor data.' };
  }
}

export interface BranchAssetStats {
  branchId: number;
  name: string;
  code: string;
  totalCount: number;
  aktifCount: number;
  rusakCount: number;
  diperbaikiCount: number;
  hilangCount: number;
}

/**
 * Server Action to fetch aggregated asset status counts grouped by branch.
 * Enforces SUPERADMIN permission boundaries.
 */
export async function getBranchAssetStats(): Promise<ApiResponse<BranchAssetStats[]>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Sesi Anda telah berakhir. Silakan masuk kembali.' };
    }

    if (user.role !== 'SUPERADMIN') {
      return { success: false, error: 'Akses ditolak: Hanya Superadmin yang dapat memuat statistik cabang.' };
    }

    // 1. Fetch branches list
    const branches = await prisma.branch.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    // 2. Aggregate count of active assets by branch and status in one database trip
    const counts = await prisma.asset.groupBy({
      by: ['branchId', 'status'],
      where: {
        archivedAt: null,
      },
      _count: {
        id: true,
      },
    });

    // 3. Map aggregates to branch objects
    const stats: BranchAssetStats[] = branches.map(b => {
      const branchCounts = counts.filter(c => c.branchId === b.id);
      
      const totalCount = branchCounts.reduce((acc, c) => acc + c._count.id, 0);
      const aktifCount = branchCounts.find(c => c.status === AssetStatus.AKTIF)?._count.id || 0;
      const rusakCount = branchCounts.find(c => c.status === AssetStatus.RUSAK)?._count.id || 0;
      const diperbaikiCount = branchCounts.find(c => c.status === AssetStatus.DIPERBAIKI)?._count.id || 0;
      const hilangCount = branchCounts.find(c => c.status === AssetStatus.HILANG)?._count.id || 0;

      return {
        branchId: b.id,
        name: b.name,
        code: b.code,
        totalCount,
        aktifCount,
        rusakCount,
        diperbaikiCount,
        hilangCount,
      };
    });

    return {
      success: true,
      data: stats,
    };
  } catch (error) {
    console.error('Error fetching branch asset stats:', error);
    return { success: false, error: 'Gagal memuat statistik aset per cabang.' };
  }
}
