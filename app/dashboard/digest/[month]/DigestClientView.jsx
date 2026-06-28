'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function DigestClientView({ digest, month, isPublic = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    if (!digest) return;
    const shareUrl = `${window.location.origin}/dashboard/digest/share/${digest.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  };

  const renderMarkdown = (text) => {
    if (!text) return null;
    return text.split('\n').map((line, idx) => {
      const clean = line.trim();
      if (clean.startsWith('##')) {
        return <h2 key={idx} className="digest-h2">{clean.replace(/^##\s*/, '')}</h2>;
      }
      if (clean.startsWith('###')) {
        return <h3 key={idx} className="digest-h3">{clean.replace(/^###\s*/, '')}</h3>;
      }
      if (clean.startsWith('**') && clean.includes('**:')) {
        const parts = clean.split('**:');
        const title = parts[0].replace(/^\*\*\s*/, '');
        const val = parts.slice(1).join('**:');
        return (
          <p key={idx} className="digest-p">
            <strong className="digest-strong">{title}:</strong>{val}
          </p>
        );
      }
      if (clean.startsWith('**') && clean.includes('**')) {
        const parts = clean.split('**');
        return (
          <p key={idx} className="digest-p">
            <strong className="digest-strong">{parts[1]}</strong>
            {parts.slice(2).join('**')}
          </p>
        );
      }
      if (clean.length === 0) return <div key={idx} style={{ height: '0.8rem' }} />;
      return <p key={idx} className="digest-p">{clean}</p>;
    });
  };

  return (
    <div className="digest-layout">
      <style jsx global>{`
        .digest-layout {
          min-height: 100vh;
          background: radial-gradient(circle at top right, rgba(16, 185, 129, 0.08), transparent 40%),
                      radial-gradient(circle at bottom left, rgba(6, 182, 212, 0.08), transparent 40%),
                      #0B0F19;
          color: #F3F4F6;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem 1rem;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .digest-container {
          max-width: 680px;
          width: 100%;
          background: rgba(17, 24, 39, 0.7);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          padding: 3rem 2.5rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          position: relative;
          overflow: hidden;
          margin-top: 1.5rem;
        }
        .digest-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, #10B981, #06B6D4);
        }
        .digest-top-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          max-width: 680px;
          margin-bottom: 0.5rem;
        }
        .digest-back-link {
          color: #9CA3AF;
          text-decoration: none;
          font-size: 0.95rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transition: color 0.2s;
        }
        .digest-back-link:hover {
          color: #F3F4F6;
        }
        .digest-share-btn {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 182, 212, 0.15) 100%);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: #10B981;
          padding: 0.6rem 1.2rem;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }
        .digest-share-btn:hover {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(6, 182, 212, 0.25) 100%);
          transform: translateY(-1px);
        }
        .digest-share-btn.copied {
          background: rgba(16, 185, 129, 0.2);
          color: #34D399;
          border-color: #34D399;
        }
        .digest-header {
          margin-bottom: 2rem;
          text-align: center;
        }
        .digest-badge {
          display: inline-block;
          background: linear-gradient(90deg, rgba(16, 185, 129, 0.15), rgba(6, 182, 212, 0.15));
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: #10B981;
          padding: 0.35rem 1rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin-bottom: 1rem;
        }
        .digest-title {
          font-family: 'Outfit', sans-serif;
          font-size: 2.25rem;
          font-weight: 700;
          background: linear-gradient(135deg, #FFFFFF 60%, #9CA3AF);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 0;
        }
        .digest-content {
          line-height: 1.8;
          color: #D1D5DB;
        }
        .digest-h2 {
          font-family: 'Outfit', sans-serif;
          font-size: 1.5rem;
          color: #F3F4F6;
          margin-top: 2rem;
          margin-bottom: 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding-bottom: 0.5rem;
        }
        .digest-h3 {
          font-family: 'Outfit', sans-serif;
          font-size: 1.2rem;
          color: #E5E7EB;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
        }
        .digest-p {
          margin-bottom: 1.2rem;
          font-size: 1.05rem;
        }
        .digest-strong {
          color: #06B6D4;
          font-weight: 600;
          margin-right: 0.5rem;
        }
        .digest-empty {
          text-align: center;
          padding: 3rem 0;
          color: #9CA3AF;
        }
        .digest-empty-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
        }
        .digest-footer {
          margin-top: 3rem;
          text-align: center;
          font-size: 0.85rem;
          color: #6B7280;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 1.5rem;
        }
      `}</style>

      <div className="digest-top-bar">
        {!isPublic ? (
          <Link href="/dashboard" className="digest-back-link">
            ← Back to Dashboard
          </Link>
        ) : (
          <span style={{ fontSize: '0.95rem', color: '#6B7280', fontWeight: 600 }}>EKATRA HEALTH</span>
        )}

        {digest && (
          <button
            onClick={handleCopyLink}
            className={`digest-share-btn ${copied ? 'copied' : ''}`}
          >
            {copied ? '✓ Link Copied' : '🔗 Share Digest'}
          </button>
        )}
      </div>

      <div className="digest-container">
        {digest ? (
          <>
            <div className="digest-header">
              <span className="digest-badge">Monthly Review</span>
              <h1 className="digest-title">{month} Summary</h1>
            </div>
            <div className="digest-content">
              {renderMarkdown(digest.digest_text)}
            </div>
            <div className="digest-footer">
              This intelligence digest is generated based on your continuous biometric data stream.
            </div>
          </>
        ) : (
          <div className="digest-empty">
            <div className="digest-empty-icon">📅</div>
            <h3>No Digest Found</h3>
            <p>
              A monthly digest for <strong>{month}</strong> is not yet available.
              Reviews are compiled automatically on the first day of each calendar month.
            </p>
            {!isPublic && (
              <Link href="/dashboard" className="digest-share-btn" style={{ display: 'inline-flex', marginTop: '1.5rem', textDecoration: 'none' }}>
                Return to Dashboard
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
