import React from 'react';

const SIcon = ({d, size=20}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
);

const SERVICES = [
  { name:'Clean & Enhance', desc:'Remove noise, fix imperfections, and enhance artwork quality.', icon:'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z' },
  { name:'Generate Inspirations', desc:'Explore endless creative variations powered by AI.', icon:'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z' },
  { name:'Create Repeat Set', desc:'Generate seamless repeating patterns in any grid size.', icon:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { name:'Dress to Design', desc:'Visualize your patterns on apparel and products.', icon:'M6.5 2H8l4 6 4-6h1.5M9 18h6M10 22h4M12 2v20' },
  { name:'Vectorize', desc:'Convert raster artwork to clean, scalable vectors.', icon:'M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z' },
];

const BRANDS = ['Studio Asta','WILD & KIND','THREADORY','PRINTWORKS','PATTERN HOUSE','MAISON ÉTOILE'];

export default function Landing({ onEnterApp }) {
  return (
    <div className="premium-landing">
      {/* Dynamic Animated Mesh Blobs */}
      <div className="bg-blobs">
        <div className="bg-blob bg-blob-1" />
        <div className="bg-blob bg-blob-2" />
        <div className="bg-blob bg-blob-3" />
      </div>

      {/* Grid Overlay */}
      <div className="grid-overlay" />

      {/* Scoped CSS Inject for Landing Overrides & Premium Styles */}
      <style>{`
        /* Dynamic premium overrides to style Landing isolated from the rest of Rimi-AI app */
        .premium-landing {
          min-height: 100vh;
          position: relative;
          background-color: #fafbfe;
          color: #0f172a;
          overflow-x: hidden;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }
        
        .premium-landing * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .premium-landing .bg-blobs {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }

        .premium-landing .bg-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(140px);
          opacity: 0.16;
          mix-blend-mode: multiply;
          animation: floatBlob 25s infinite alternate ease-in-out;
        }

        .premium-landing .bg-blob-1 {
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, #6366f1 0%, #a5b4fc 100%);
          top: -10%;
          left: -5%;
        }

        .premium-landing .bg-blob-2 {
          width: 700px;
          height: 700px;
          background: radial-gradient(circle, #f472b6 0%, #c084fc 100%);
          top: 15%;
          right: -10%;
          animation-delay: -6s;
          animation-duration: 30s;
        }

        .premium-landing .bg-blob-3 {
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, #22d3ee 0%, #818cf8 100%);
          bottom: 5%;
          left: 10%;
          animation-delay: -12s;
          animation-duration: 22s;
        }

        @keyframes floatBlob {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(80px, 50px) scale(1.1); }
          100% { transform: translate(-50px, 90px) scale(0.95); }
        }

        .premium-landing .grid-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: 
            radial-gradient(rgba(99, 102, 241, 0.08) 1.5px, transparent 1.5px),
            linear-gradient(rgba(226, 232, 240, 0.25) 1px, transparent 1px),
            linear-gradient(90deg, rgba(226, 232, 240, 0.25) 1px, transparent 1px);
          background-size: 24px 24px, 72px 72px, 72px 72px;
          background-position: 0 0, 0 0, 0 0;
          pointer-events: none;
          z-index: 1;
        }

        .premium-landing .content-wrap {
          position: relative;
          z-index: 10;
        }

        /* Glassmorphic Navbar */
        .premium-landing .ln-nav {
          border-bottom: 1px solid rgba(226, 232, 240, 0.7);
          padding: 1.15rem 0;
          position: sticky;
          top: 0;
          background: rgba(255, 255, 255, 0.75);
          backdrop-filter: blur(24px) saturate(180%);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          z-index: 100;
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.01);
          transition: all 0.3s ease;
        }

        .premium-landing .ln-nav-inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .premium-landing .ln-nav-left {
          display: flex;
          align-items: center;
          gap: 3rem;
        }

        .premium-landing .ln-logo {
          font-size: 1.3rem;
          font-weight: 800;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          letter-spacing: -0.02em;
        }

        .premium-landing .ln-logo-badge {
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          color: #fff;
          font-weight: 800;
          border-radius: 8px;
          padding: 0.2rem 0.5rem;
          font-size: 0.85rem;
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
        }

        .premium-landing .ln-nav-links {
          display: flex;
          gap: 2rem;
          font-size: 0.9rem;
          color: #475569;
          font-weight: 600;
        }

        .premium-landing .ln-nav-links a {
          position: relative;
          color: #475569;
          transition: color 0.25s;
          text-decoration: none;
        }

        .premium-landing .ln-nav-links a::after {
          content: '';
          position: absolute;
          bottom: -4px;
          left: 0;
          width: 0;
          height: 2px;
          background: #6366f1;
          transition: width 0.25s;
          border-radius: 2px;
        }

        .premium-landing .ln-nav-links a:hover {
          color: #6366f1;
        }

        .premium-landing .ln-nav-links a:hover::after {
          width: 100%;
        }

        .premium-landing .ln-nav-right {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .premium-landing .ln-btn-ghost {
          background: none;
          border: none;
          color: #475569;
          font-weight: 600;
          font-size: 0.9rem;
          padding: 0.55rem 1.15rem;
          transition: all 0.25s;
          border-radius: 8px;
          cursor: pointer;
        }

        .premium-landing .ln-btn-ghost:hover {
          color: #6366f1;
          background: rgba(99, 102, 241, 0.05);
        }

        .premium-landing .ln-btn-primary {
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 0.65rem 1.45rem;
          font-weight: 700;
          font-size: 0.9rem;
          box-shadow: 0 4px 18px rgba(99, 102, 241, 0.25);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
        }

        .premium-landing .ln-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(99, 102, 241, 0.4);
          background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
        }

        .premium-landing .ln-btn-outline {
          background: rgba(255, 255, 255, 0.65);
          color: #1e293b;
          border: 1.5px solid rgba(203, 213, 225, 0.8);
          border-radius: 10px;
          padding: 0.65rem 1.45rem;
          font-weight: 700;
          font-size: 0.9rem;
          backdrop-filter: blur(8px);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
        }

        .premium-landing .ln-btn-outline:hover {
          border-color: #6366f1;
          color: #6366f1;
          background: rgba(99, 102, 241, 0.04);
          transform: translateY(-2px);
        }

        .premium-landing .ln-btn-lg {
          padding: 0.85rem 2rem;
          font-size: 1rem;
          border-radius: 12px;
        }

        /* Hero */
        .premium-landing .ln-hero {
          max-width: 1200px;
          margin: 0 auto;
          padding: 5.5rem 2rem 4.5rem;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4rem;
          align-items: center;
        }

        .premium-landing .ln-hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(99, 102, 241, 0.07);
          border: 1px solid rgba(99, 102, 241, 0.18);
          color: #6366f1;
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.45rem 1rem;
          border-radius: 99px;
          margin-bottom: 1.5rem;
          letter-spacing: 0.06em;
          box-shadow: 0 4px 10px rgba(99, 102, 241, 0.02);
        }

        .premium-landing .ln-hero-text h1 {
          font-size: 3.35rem;
          font-weight: 900;
          line-height: 1.15;
          letter-spacing: -0.03em;
          margin-bottom: 1.25rem;
          color: #0f172a;
        }

        .premium-landing .ln-hero-accent {
          background: linear-gradient(135deg, #6366f1 20%, #ec4899 80%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          display: inline-block;
        }

        .premium-landing .ln-hero-text p {
          font-size: 1.125rem;
          color: #475569;
          line-height: 1.65;
          margin-bottom: 2.25rem;
          max-width: 520px;
        }

        .premium-landing .ln-hero-actions {
          display: flex;
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .premium-landing .ln-hero-trust {
          display: flex;
          gap: 1.5rem;
          font-size: 0.85rem;
          color: #64748b;
          font-weight: 600;
        }

        .premium-landing .ln-hero-trust span {
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }

        .premium-landing .ln-hero-visual {
          display: flex;
          justify-content: flex-end;
          position: relative;
        }

        /* Mockup Container */
        .premium-landing .ln-hero-mockup {
          width: 100%;
          max-width: 540px;
          border: 1px solid rgba(226, 232, 240, 0.8);
          background: rgba(255, 255, 255, 0.75);
          backdrop-filter: blur(20px);
          box-shadow: 0 25px 50px -12px rgba(99, 102, 241, 0.12), 0 0 30px rgba(0, 0, 0, 0.01);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .premium-landing .ln-hero-mockup:hover {
          transform: translateY(-4px);
          box-shadow: 0 35px 60px -10px rgba(99, 102, 241, 0.18);
        }

        .premium-landing .ln-mockup-chrome {
          background: rgba(248, 250, 252, 0.8);
          border-bottom: 1px solid rgba(226, 232, 240, 0.8);
          height: 38px;
          padding: 0 1rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .premium-landing .ln-chrome-dots {
          display: flex;
          gap: 6px;
        }

        .premium-landing .ln-chrome-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .premium-landing .ln-chrome-title {
          font-size: 0.7rem;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.02em;
        }

        .premium-landing .ln-mockup-body {
          display: flex;
          flex: 1;
          height: 330px;
        }

        .premium-landing .ln-mockup-sidebar {
          width: 155px;
          border-right: 1px solid rgba(226, 232, 240, 0.8);
          background: rgba(248, 250, 252, 0.55);
          padding: 0.9rem;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .premium-landing .ln-mockup-logo {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 800;
          font-size: 0.72rem;
          color: #1e293b;
          margin-bottom: 0.75rem;
        }

        .premium-landing .ln-mockup-logo-badge {
          background: #6366f1;
          color: #fff;
          border-radius: 4px;
          padding: 1px 4px;
          font-size: 0.55rem;
          font-weight: 900;
        }

        .premium-landing .ln-mockup-item {
          transition: all 0.2s ease;
          border-radius: 6px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .premium-landing .ln-mockup-item.active {
          background: rgba(99, 102, 241, 0.08) !important;
          color: #6366f1 !important;
          font-weight: 700 !important;
        }

        .premium-landing .ln-mockup-item:hover:not(.active) {
          background: rgba(226, 232, 240, 0.45);
          color: #1e293b !important;
        }

        .premium-landing .ln-mockup-main {
          flex: 1;
          padding: 1.15rem;
          background: #fff;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
        }

        .premium-landing .ln-mockup-grid-wrapper {
          flex: 1;
          border-radius: 10px;
          overflow: hidden;
          border: 1px dashed rgba(99, 102, 241, 0.25);
          background: #f8fafc;
          position: relative;
          margin-bottom: 0.75rem;
        }

        .premium-landing .ln-mockup-pattern-pan {
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%236366F1' fill-opacity='0.08'%3E%3Cpath d='M50 50c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10c0 5.523-4.477 10-10 10s-10-4.477-10-10 4.477-10 10-10zM10 10c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10c0 5.523-4.477 10-10 10S0 25.523 0 20s4.477-10 10-10zm10 8c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8zm40 40c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8z'/%3E%3C/g%3E%3Cg fill='%23ec4899' fill-opacity='0.06'%3E%3Cpath d='M30 50c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10c0 5.523-4.477 10-10 10s-10-4.477-10-10 4.477-10 10-10zm10 8c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
          background-size: 80px 80px;
          animation: panPattern 22s linear infinite;
        }

        @keyframes panPattern {
          from { background-position: 0 0; }
          to { background-position: 160px 160px; }
        }

        .premium-landing .ln-mockup-pattern-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0) 65%, rgba(255,255,255,0.92) 100%);
          pointer-events: none;
        }

        .premium-landing .ln-mockup-indicator {
          position: absolute;
          top: 12px;
          right: 12px;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(99, 102, 241, 0.22);
          color: #6366f1;
          padding: 3px 8px;
          border-radius: 99px;
          font-size: 0.58rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 5px;
          box-shadow: 0 4px 10px rgba(99, 102, 241, 0.05);
        }

        .premium-landing .ln-indicator-pulse {
          width: 5px;
          height: 5px;
          background: #6366f1;
          border-radius: 50%;
          animation: pulseColor 1.2s infinite alternate ease-in-out;
        }

        @keyframes pulseColor {
          from { opacity: 0.4; transform: scale(0.85); }
          to { opacity: 1; transform: scale(1.25); }
        }

        .premium-landing .ln-mockup-controls {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .premium-landing .ln-mockup-title {
          font-size: 0.75rem;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 0.15rem;
        }

        .premium-landing .ln-mockup-desc {
          font-size: 0.58rem;
          color: #64748b;
          margin-bottom: 0.6rem;
        }

        .premium-landing .ln-mockup-vars {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .premium-landing .ln-mockup-palette {
          display: flex;
          gap: 4px;
        }

        .premium-landing .ln-mockup-color {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 1px solid rgba(0, 0, 0, 0.08);
        }

        .premium-landing .ln-mockup-scale {
          font-size: 0.58rem;
          font-weight: 700;
          color: #6366f1;
          background: rgba(99, 102, 241, 0.08);
          padding: 2px 6px;
          border-radius: 4px;
        }

        /* Services Cards Grid */
        .premium-landing .ln-services {
          max-width: 1200px;
          margin: 0 auto;
          padding: 6rem 2rem 4rem;
        }

        .premium-landing .ln-section-head {
          text-align: center;
          max-width: 680px;
          margin: 0 auto 3.5rem;
        }

        .premium-landing .ln-section-head h2 {
          font-size: 2.5rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #0f172a;
          margin-bottom: 0.85rem;
        }

        .premium-landing .ln-section-head p {
          font-size: 1.1rem;
          color: #475569;
          line-height: 1.6;
        }

        .premium-landing .ln-services-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 1.25rem;
        }

        .premium-landing .ln-service-card {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 250px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(226, 232, 240, 0.8);
          border-radius: 16px;
          padding: 1.75rem 1.45rem;
          cursor: pointer;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
          text-decoration: none;
        }

        .premium-landing .ln-service-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, #6366f1, #ec4899);
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .premium-landing .ln-service-card:hover {
          transform: translateY(-6px);
          border-color: rgba(99, 102, 241, 0.3);
          box-shadow: 0 20px 40px -10px rgba(99, 102, 241, 0.12);
          background: rgba(255, 255, 255, 0.9);
        }

        .premium-landing .ln-service-card:hover::before {
          opacity: 1;
        }

        .premium-landing .ln-service-icon {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: rgba(99, 102, 241, 0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #6366f1;
          transition: all 0.3s ease;
          margin-bottom: auto;
        }

        .premium-landing .ln-service-card:hover .ln-service-icon {
          background: #6366f1;
          color: #fff;
          transform: scale(1.08);
          box-shadow: 0 6px 15px rgba(99, 102, 241, 0.2);
        }

        .premium-landing .ln-service-text-wrap {
          margin-top: 1.5rem;
        }

        .premium-landing .ln-service-name {
          font-weight: 700;
          font-size: 0.95rem;
          color: #0f172a;
          margin-bottom: 0.4rem;
        }

        .premium-landing .ln-service-desc {
          font-size: 0.78rem;
          color: #475569;
          line-height: 1.45;
        }

        .premium-landing .ln-service-arrow {
          position: absolute;
          bottom: 1.25rem;
          right: 1.25rem;
          color: #6366f1;
          font-size: 0.9rem;
          font-weight: bold;
          opacity: 0;
          transform: translateX(-6px);
          transition: all 0.3s ease;
        }

        .premium-landing .ln-service-card:hover .ln-service-arrow {
          opacity: 1;
          transform: translateX(0);
        }

        /* Workflow Steps */
        .premium-landing .ln-workflow {
          max-width: 1200px;
          margin: 0 auto;
          padding: 4rem 2rem 5rem;
        }

        .premium-landing .ln-workflow-inner {
          display: grid;
          grid-template-columns: 1fr 1.1fr;
          gap: 5rem;
          align-items: center;
        }

        .premium-landing .ln-workflow-upload {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.25rem;
          padding: 3.5rem 2.5rem;
          border: 2px dashed rgba(99, 102, 241, 0.3);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.55);
          backdrop-filter: blur(12px);
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
          text-align: center;
          position: relative;
        }

        .premium-landing .ln-workflow-upload::after {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 20px;
          padding: 2px;
          background: linear-gradient(135deg, #6366f1, #ec4899);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.4s ease;
        }

        .premium-landing .ln-workflow-upload:hover {
          transform: translateY(-2px);
          border-color: transparent;
          background: rgba(255, 255, 255, 0.85);
          box-shadow: 0 20px 40px rgba(99, 102, 241, 0.08);
        }

        .premium-landing .ln-workflow-upload:hover::after {
          opacity: 1;
        }

        .premium-landing .ln-upload-icon {
          width: 60px;
          height: 60px;
          border-radius: 16px;
          background: rgba(99, 102, 241, 0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.3s ease;
        }

        .premium-landing .ln-workflow-upload:hover .ln-upload-icon {
          transform: scale(1.06) rotate(3deg);
          background: rgba(99, 102, 241, 0.1);
        }

        .premium-landing .ln-upload-label {
          font-weight: 800;
          font-size: 1.05rem;
          color: #0f172a;
          margin-bottom: 0.15rem;
        }

        .premium-landing .ln-upload-desc {
          font-size: 0.82rem;
          color: #475569;
          line-height: 1.5;
        }

        .premium-landing .ln-workflow-steps {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .premium-landing .ln-workflow-step {
          display: flex;
          gap: 1.25rem;
          align-items: flex-start;
          background: rgba(255, 255, 255, 0.45);
          border: 1px solid rgba(226, 232, 240, 0.6);
          padding: 1.25rem 1.5rem;
          border-radius: 14px;
          transition: all 0.3s ease;
        }

        .premium-landing .ln-workflow-step:hover {
          background: rgba(255, 255, 255, 0.85);
          border-color: rgba(99, 102, 241, 0.25);
          transform: translateX(4px);
          box-shadow: 0 10px 25px rgba(99, 102, 241, 0.04);
        }

        .premium-landing .ln-step-dot {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.8rem;
          font-weight: 800;
          flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
        }

        .premium-landing .ln-step-title {
          font-weight: 700;
          font-size: 0.95rem;
          color: #0f172a;
          margin-bottom: 0.25rem;
        }

        .premium-landing .ln-step-desc {
          font-size: 0.82rem;
          color: #475569;
          line-height: 1.5;
        }

        /* Social Proof */
        .premium-landing .ln-social-proof {
          background: linear-gradient(180deg, rgba(248, 250, 252, 0.35) 0%, rgba(255, 255, 255, 0.8) 100%);
          border-top: 1px solid rgba(226, 232, 240, 0.6);
          padding: 5rem 0;
        }

        .premium-landing .ln-brands {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2rem 2rem;
        }

        .premium-landing .ln-brands-label {
          font-size: 0.72rem;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 2rem;
          text-align: center;
        }

        .premium-landing .ln-brands-list {
          display: flex;
          gap: 3.5rem;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
        }

        .premium-landing .ln-brand {
          font-size: 1rem;
          font-weight: 800;
          color: #94a3b8;
          letter-spacing: 0.05em;
          transition: all 0.25s ease;
        }

        .premium-landing .ln-brand:hover {
          color: #6366f1;
        }

        .premium-landing .ln-testimonial-row {
          max-width: 1200px;
          margin: 4.5rem auto 0;
          padding: 0 2rem;
          display: grid;
          grid-template-columns: 1.8fr 1.2fr;
          gap: 4.5rem;
          align-items: center;
        }

        .premium-landing .ln-testimonial {
          position: relative;
          padding: 2.75rem 3rem;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(226, 232, 240, 0.8);
          backdrop-filter: blur(20px);
          border-radius: 24px;
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.01);
        }

        .premium-landing .ln-quote-mark {
          font-size: 5rem;
          line-height: 0.1;
          margin-bottom: 1.25rem;
          font-family: Georgia, serif;
          background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .premium-landing .ln-testimonial p {
          font-size: 1.2rem;
          color: #1e293b;
          line-height: 1.65;
          font-style: normal;
          font-weight: 500;
        }

        .premium-landing .ln-quote-author {
          font-size: 0.9rem;
          font-weight: 700;
          color: #6366f1;
          margin-top: 1.75rem;
          letter-spacing: -0.01em;
        }

        .premium-landing .ln-stats {
          display: flex;
          gap: 3.5rem;
          justify-content: flex-start;
        }

        .premium-landing .ln-stat {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .premium-landing .ln-stat-num {
          font-size: 3.25rem;
          font-weight: 900;
          background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -0.04em;
          line-height: 1;
        }

        .premium-landing .ln-stat-label {
          font-size: 0.85rem;
          font-weight: 600;
          color: #475569;
          margin-top: 0.5rem;
        }

        /* Footer */
        .premium-landing .ln-footer {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding: 2.5rem 0;
          background: #0b0f19;
          color: #94a3b8;
          position: relative;
          z-index: 10;
        }

        .premium-landing .ln-footer-inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2rem;
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
          font-weight: 500;
        }

        /* Responsive */
        @media(max-width:1024px){
          .premium-landing .ln-hero {
            grid-template-columns: 1fr;
            text-align: center;
            padding: 4.5rem 2rem 3.5rem;
          }
          .premium-landing .ln-hero-text p {
            margin-left: auto;
            margin-right: auto;
          }
          .premium-landing .ln-hero-actions {
            justify-content: center;
          }
          .premium-landing .ln-hero-trust {
            justify-content: center;
          }
          .premium-landing .ln-hero-visual {
            justify-content: center;
            order: -1;
          }
          .premium-landing .ln-services-grid {
            grid-template-columns: repeat(3, 1fr);
          }
          .premium-landing .ln-workflow-inner {
            grid-template-columns: 1fr;
            gap: 3.5rem;
          }
          .premium-landing .ln-testimonial-row {
            grid-template-columns: 1fr;
            gap: 3rem;
            margin-top: 3rem;
          }
          .premium-landing .ln-stats {
            justify-content: center;
            gap: 5rem;
          }
        }

        @media(max-width:768px) {
          .premium-landing .ln-nav-links {
            display: none;
          }
          .premium-landing .ln-hero-text h1 {
            font-size: 2.5rem;
          }
          .premium-landing .ln-services-grid {
            grid-template-columns: 1fr 1fr;
          }
          .premium-landing .ln-brands-list {
            gap: 2rem;
          }
          .premium-landing .ln-footer-inner {
            flex-direction: column;
            gap: 0.75rem;
            text-align: center;
          }
        }

        @media(max-width:480px) {
          .premium-landing .ln-services-grid {
            grid-template-columns: 1fr;
          }
          .premium-landing .ln-hero-text h1 {
            font-size: 2.1rem;
          }
        }
      `}</style>

      {/* Main Content Stacked Nicely Above the Mesh Overlay */}
      <div className="content-wrap">
        {/* Navbar */}
        <nav className="ln-nav">
          <div className="ln-nav-inner">
            <div className="ln-nav-left">
              <div className="ln-logo">
                <span className="ln-logo-badge">RI</span> RIM AI
              </div>
              <div className="ln-nav-links">
                <a href="#services">Services</a>
                <a href="#workflow">Workflow</a>
                <a href="#pricing" onClick={(e) => { e.preventDefault(); onEnterApp(); }}>Pricing</a>
                <a href="#docs" onClick={(e) => { e.preventDefault(); onEnterApp(); }}>Docs</a>
              </div>
            </div>
            <div className="ln-nav-right">
              <button className="ln-btn-ghost" onClick={onEnterApp}>Log in</button>
              <button className="ln-btn-primary" onClick={onEnterApp}>Start Free Trial →</button>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="ln-hero">
          <div className="ln-hero-text">
            <div className="ln-hero-badge">✦ AI-POWERED DESIGN PLATFORM</div>
            <h1>
              Professional AI Tools for Pattern Design & <span className="ln-hero-accent">Print-Ready Textiles</span>
            </h1>
            <p>
              Clean, enhance, generate creative variations, create repeat sets, and vectorize — all powered by next-gen artificial intelligence designed for textile professionals.
            </p>
            <div className="ln-hero-actions">
              <button className="ln-btn-primary ln-btn-lg" onClick={onEnterApp}>Start Free Trial →</button>
              <button className="ln-btn-outline ln-btn-lg" onClick={onEnterApp}>Book Demo</button>
            </div>
            <div className="ln-hero-trust">
              <span>✓ No credit card required</span>
              <span>⚡ Setup in 30 seconds</span>
              <span>🔒 Secure & private</span>
            </div>
          </div>

          {/* Active AI Workspace Mockup */}
          <div className="ln-hero-visual">
            <div className="ln-hero-mockup">
              {/* Window chrome bar */}
              <div className="ln-mockup-chrome">
                <div className="ln-chrome-dots">
                  <div className="ln-chrome-dot" style={{background:'#ff5f56'}} />
                  <div className="ln-chrome-dot" style={{background:'#ffbd2e'}} />
                  <div className="ln-chrome-dot" style={{background:'#27c93f'}} />
                </div>
                <div className="ln-chrome-title">RIM AI Workspace — Repeating Pattern Generator</div>
                <div style={{width: 32}} /> {/* spacer for center alignment */}
              </div>

              <div className="ln-mockup-body">
                {/* Sidebar */}
                <div className="ln-mockup-sidebar">
                  <div className="ln-mockup-logo">
                    <span className="ln-mockup-logo-badge">RI</span>
                    <span style={{fontWeight: 700}}>RIM AI</span>
                  </div>
                  <div style={{fontSize:'0.55rem',color:'#94a3b8',fontWeight:700,margin:'0.35rem 0',textTransform:'uppercase',letterSpacing:'0.05em'}}>AI Tools</div>
                  {[
                    {name: 'Clean & Enhance', active: false},
                    {name: 'Generate Inspirations', active: false},
                    {name: 'Create Repeat Set', active: true},
                    {name: 'Dress to Design', active: false},
                    {name: 'Vectorize', active: false}
                  ].map((item, idx) => (
                    <div 
                      key={item.name} 
                      className={`ln-mockup-item ${item.active ? 'active' : ''}`} 
                      style={{
                        fontSize:'0.58rem',
                        padding:'0.35rem 0.5rem',
                        borderRadius: 6,
                        color: item.active ? '#6366f1' : '#64748b',
                        fontWeight: item.active ? 700 : 500,
                        background: item.active ? 'rgba(99, 102, 241, 0.08)' : 'transparent'
                      }}
                    >
                      <span style={{fontSize:'0.65rem'}}>{['✨','🎨','🔁','👕','📐'][idx]}</span>
                      {item.name}
                    </div>
                  ))}
                </div>

                {/* Main panel */}
                <div className="ln-mockup-main">
                  {/* Pattern panning box */}
                  <div className="ln-mockup-grid-wrapper">
                    <div className="ln-mockup-pattern-pan" />
                    <div className="ln-mockup-pattern-overlay" />
                    <div className="ln-mockup-indicator">
                      <div className="ln-indicator-pulse" />
                      Seamless Match: 100%
                    </div>
                  </div>

                  {/* Mockup controls */}
                  <div className="ln-mockup-controls">
                    <div className="ln-mockup-title">Repeat Set Mode</div>
                    <div className="ln-mockup-desc">Generating seamless repeating pattern in perfect standard grid.</div>
                    <div className="ln-mockup-vars">
                      <div className="ln-mockup-palette">
                        {['#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1'].map((c, i) => (
                          <div key={i} className="ln-mockup-color" style={{background: c}} />
                        ))}
                      </div>
                      <div className="ln-mockup-scale">Tiling Scale: 2x</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Services Cards */}
        <section className="ln-services" id="services">
          <div className="ln-section-head">
            <h2>Supercharge Your Pattern Workflow</h2>
            <p>Every professional tool you need to design, repeat, enhance, and scale print-ready textiles in a single unified platform.</p>
          </div>
          <div className="ln-services-grid">
            {SERVICES.map(s => (
              <div key={s.name} className="ln-service-card" onClick={onEnterApp}>
                <div className="ln-service-icon">
                  <SIcon d={s.icon} size={22} />
                </div>
                <div className="ln-service-text-wrap">
                  <div className="ln-service-name">{s.name}</div>
                  <div className="ln-service-desc">{s.desc}</div>
                </div>
                <span className="ln-service-arrow">→</span>
              </div>
            ))}
          </div>
        </section>

        {/* Workflow Section */}
        <section className="ln-workflow" id="workflow">
          <div className="ln-workflow-inner">
            <div className="ln-workflow-upload" onClick={onEnterApp}>
              <div className="ln-upload-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
              </div>
              <div>
                <div className="ln-upload-label">Upload Your Artwork</div>
                <div className="ln-upload-desc">
                  Drag & drop an image here, or browse.<br/>
                  Supports JPG, PNG, WEBP up to 25MB.
                </div>
              </div>
            </div>
            
            <div className="ln-workflow-steps">
              {[
                {t:'AI-Powered Processing',d:'Our advanced neural networks analyze composition boundaries to seamlessly fill and complete visual imperfections.'},
                {t:'Perfect Repeating Patterns',d:'Convert artwork variations into flawless repeat grids at any scale without visible lines or mismatch joints.'},
                {t:'Lossless Vectorization & Exports',d:'Export final outputs to high-res JPG, PNG, or convert them into crystal-clear vector paths with custom nodes.'},
              ].map((s, idx) => (
                <div key={s.t} className="ln-workflow-step">
                  <div className="ln-step-dot">{idx + 1}</div>
                  <div>
                    <div className="ln-step-title">{s.t}</div>
                    <div className="ln-step-desc">{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Brands + Testimonial */}
        <section className="ln-social-proof">
          <div className="ln-brands">
            <div className="ln-brands-label">TRUSTED BY LEADING DESIGN STUDIOS & BRANDS</div>
            <div className="ln-brands-list">
              {BRANDS.map(b => (
                <span key={b} className="ln-brand">{b}</span>
              ))}
            </div>
          </div>

          <div className="ln-testimonial-row">
            <div className="ln-testimonial">
              <div className="ln-quote-mark">“</div>
              <p>RIM AI has completely revolutionized our workflow. We can now go from simple artwork sketches to print-ready textile repeat structures in minutes rather than days. The vectorizer quality is absolutely unmatched.</p>
              <div className="ln-quote-author">— Sarah Lin, Creative Director at Pattern House</div>
            </div>
            
            <div className="ln-stats">
              <div className="ln-stat">
                <span className="ln-stat-num">10K+</span>
                <span className="ln-stat-label">Designers Worldwide</span>
              </div>
              <div className="ln-stat">
                <span className="ln-stat-num">2M+</span>
                <span className="ln-stat-label">Patterns Generated</span>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="ln-footer">
          <div className="ln-footer-inner">
            <span>© {new Date().getFullYear()} RIM AI — All rights reserved.</span>
            <span>Made with ❤️ for designers & textile professionals</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
