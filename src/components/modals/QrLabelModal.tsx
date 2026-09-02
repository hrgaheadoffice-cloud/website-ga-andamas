'use client';

import { X, Download, Calendar } from 'lucide-react';
import QRCode from 'react-qr-code';
import Barcode from 'react-barcode';
import { toJpeg } from 'html-to-image';
import jsPDF from 'jspdf';
import type { AssetWithRelations } from '@/lib/actions/assets';

interface QrLabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: AssetWithRelations | null;
}

export default function QrLabelModal({
  isOpen,
  onClose,
  asset,
}: QrLabelModalProps) {
  if (!isOpen || !asset) return null;

  // Generate filename based on assetTag or ID
  const fileName = asset.assetTag 
    ? asset.assetTag.replace(/[^a-zA-Z0-9]/g, '_') 
    : `asset_${asset.id}`;

  // Download as JPG
  const handleDownloadJPG = async () => {
    const element = document.getElementById('printable-label');
    if (!element) return;

    try {
      // Get exact dimensions of the label element
      const width = element.offsetWidth;
      const height = element.offsetHeight;

      const dataUrl = await toJpeg(element, {
        quality: 1.0,
        backgroundColor: '#ffffff',
        pixelRatio: 3, // HD quality for stickers
        width: width,
        height: height,
        style: {
          margin: '0',
          transform: 'none',
        }
      });
      
      const link = document.createElement('a');
      link.download = `Label_${fileName}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Error generating JPG:', error);
    }
  };

  // Download as PDF
  const handleDownloadPDF = async () => {
    const element = document.getElementById('printable-label');
    if (!element) return;

    try {
      // Get exact dimensions of the label element
      const width = element.offsetWidth;
      const height = element.offsetHeight;

      const dataUrl = await toJpeg(element, {
        quality: 1.0,
        backgroundColor: '#ffffff',
        pixelRatio: 3, // HD quality for stickers
        width: width,
        height: height,
        style: {
          margin: '0',
          transform: 'none',
        }
      });

      // Calculate PDF dimensions dynamically (px to mm: 1px ≈ 0.264583mm at 96dpi)
      const pxToMm = 0.264583;
      const imgWidth = width * pxToMm;
      const imgHeight = height * pxToMm;
      
      const pdf = new jsPDF({
        orientation: imgHeight > imgWidth ? 'portrait' : 'landscape',
        unit: 'mm',
        format: [imgWidth, imgHeight]
      });
      
      pdf.addImage(dataUrl, 'JPEG', 0, 0, imgWidth, imgHeight);
      pdf.save(`Label_${fileName}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
    }
  };

  // Generate nilai untuk QR code (gunakan assetTag atau URL lengkap)
  const qrValue = asset.assetTag 
    ? asset.assetTag 
    : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/inventaris/${asset.id}`;

  // Dapatkan nama cabang
  const branchName = asset.branch?.name || 'PT Andamas Global Energi';
  const purchaseYear = asset.purchaseYear || new Date().getFullYear();

  return (
    <>
      {/* Overlay modal - Full screen backdrop */}
      <div 
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}
        onClick={onClose}
      >
        {/* Modal content card */}
        <div 
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '440px',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Modal */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1f2937' }}>
              Label Aset
            </h2>
            <button 
              onClick={onClose}
              style={{ 
                background: 'none', 
                border: 'none', 
                cursor: 'pointer', 
                padding: '8px',
                borderRadius: '8px',
                transition: 'background-color 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <X size={20} color="#6b7280" />
            </button>
          </div>

          {/* Label Card - Landscape, monokrom: header hitam, tengah putih, bawah hitam */}
          <div id="printable-label" style={{
            width: '380px',
            margin: '0 auto 24px auto',
            borderRadius: '12px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 12px 28px -8px rgba(0,0,0,0.4)',
          }}>
            {/* Header: logo + nama cabang + status */}
            <div style={{
              backgroundColor: '#14171c',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '9px 14px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <img
                  src="/Logo_Login.png"
                  alt="Logo Perusahaan"
                  style={{ height: '18px', width: 'auto', flexShrink: 0 }}
                />
                <span style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.6px',
                  color: '#ffffff',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {branchName}
                </span>
              </div>
              <span style={{
                fontSize: '8px',
                fontWeight: 700,
                letterSpacing: '1px',
                color: '#9aa0a8',
                textTransform: 'uppercase',
                flexShrink: 0,
                marginLeft: '8px'
              }}>
                Aset Terdaftar
              </span>
            </div>

            {/* Tengah: putih - QR (2D, kecil) + detail aset, diapit rel hitam kanan-kiri */}
            <div style={{ display: 'flex', backgroundColor: '#ffffff' }}>
              {/* Rel kiri */}
              <div style={{
                width: '10px',
                flexShrink: 0,
                backgroundColor: '#14171c',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
              }}>
                {[0, 1, 2].map((i) => (
                  <span key={`dl-${i}`} style={{
                    width: '3px',
                    height: '3px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(255,255,255,0.5)'
                  }} />
                ))}
              </div>

              <div style={{
                flex: 1,
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                padding: '10px 12px'
              }}>
                <div style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  padding: '4px',
                  flexShrink: 0,
                  lineHeight: 0
                }}>
                  <QRCode value={qrValue} size={56} level="M" />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
                  <h3 style={{
                    margin: 0,
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#111827',
                    textTransform: 'uppercase',
                    letterSpacing: '0.3px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {asset.name}
                  </h3>
                  <span style={{
                    display: 'inline-block',
                    width: 'fit-content',
                    backgroundColor: '#14171c',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    padding: '2px 10px',
                    borderRadius: '999px'
                  }}>
                    {asset.assetTag || '-'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#6b7280', fontSize: '10px' }}>
                    <Calendar size={11} color="#6b7280" />
                    Tahun: {purchaseYear}
                  </div>
                </div>
              </div>

              {/* Rel kanan */}
              <div style={{
                width: '10px',
                flexShrink: 0,
                backgroundColor: '#14171c',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
              }}>
                {[0, 1, 2].map((i) => (
                  <span key={`dr-${i}`} style={{
                    width: '3px',
                    height: '3px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(255,255,255,0.5)'
                  }} />
                ))}
              </div>
            </div>

            {/* Bawah: hitam - barcode 1D untuk scanner gudang / kompatibilitas lama */}
            <div style={{
              backgroundColor: '#14171c',
              padding: '8px 14px 10px 14px',
              display: 'flex',
              justifyContent: 'center'
            }}>
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '6px',
                padding: '5px 8px 3px 8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center'
              }}>
                <Barcode
                  value={asset.assetTag || String(asset.id)}
                  format="CODE128"
                  width={1.2}
                  height={24}
                  displayValue={false}
                  background="#ffffff"
                  lineColor="#111827"
                  margin={0}
                />
                <span style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  letterSpacing: '1.5px',
                  color: '#111827',
                  marginTop: '2px'
                }}>
                  {asset.assetTag || asset.id}
                </span>
              </div>
            </div>
          </div>

          {/* Tombol Download - 2 kolom */}
          <div style={{ 
            display: 'flex',
            gap: '12px',
            width: '100%'
          }}>
            {/* Download JPG */}
            <button
              onClick={handleDownloadJPG}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: '#059669',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#047857'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#059669'}
            >
              <Download size={16} />
              JPG
            </button>

            {/* Download PDF */}
            <button
              onClick={handleDownloadPDF}
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#b91c1c'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
            >
              <Download size={16} />
              PDF
            </button>
          </div>
        </div>
      </div>


    </>
  );
}