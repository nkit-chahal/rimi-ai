const SIcon = ({d, size=20}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;

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
    <div className="landing">
      {/* Navbar */}
      <nav className="ln-nav">
        <div className="ln-nav-inner">
          <div className="ln-nav-left">
            <div className="ln-logo"><span className="ln-logo-badge">RI</span> RIM AI</div>
            <div className="ln-nav-links">
              <a href="#services">Services <span style={{fontSize:'0.6rem'}}>▼</span></a>
              <a href="#gallery">Gallery</a>
              <a href="#pricing">Pricing</a>
              <a href="#docs">Docs</a>
            </div>
          </div>
          <div className="ln-nav-right">
            <button className="ln-btn-ghost" onClick={onEnterApp}>Log in</button>
            <button className="ln-btn-primary" onClick={onEnterApp}>Start Free Trial →</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="ln-hero">
        <div className="ln-hero-inner">
          <div className="ln-hero-text">
            <div className="ln-hero-badge">✦ AI-POWERED DESIGN PLATFORM</div>
            <h1>Professional AI Tools for Pattern Design & <span className="ln-hero-accent">Print-Ready Textiles</span></h1>
            <p>Clean, enhance, generate creative variations, create repeat sets, and vectorize — all in one place.</p>
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
          <div className="ln-hero-visual">
            <div className="ln-hero-mockup">
              <div className="ln-mockup-sidebar">
                <div className="ln-mockup-logo"><span className="ln-logo-badge" style={{fontSize:'0.5rem',padding:'1px 3px'}}>RI</span> <span style={{fontSize:'0.65rem',fontWeight:700}}>RIM AI</span></div>
                <div style={{fontSize:'0.5rem',color:'#94a3b8',fontWeight:700,margin:'0.5rem 0 0.25rem',textTransform:'uppercase',letterSpacing:'0.05em'}}>AI Tools</div>
                {['Clean & Enhance','Generate Inspirations','Create Repeat Set','Dress to Design','Vectorize'].map((n,i)=>(
                  <div key={n} className={`ln-mockup-item ${i===2?'active':''}`} style={{fontSize:'0.55rem',padding:'0.2rem 0.35rem',borderRadius:4,marginBottom:2,color:i===2?'var(--primary)':'#64748b',background:i===2?'#f0eeff':'transparent',fontWeight:i===2?600:400}}>{n}</div>
                ))}
              </div>
              <div className="ln-mockup-main">
                <div style={{fontSize:'0.7rem',fontWeight:700,marginBottom:'0.35rem'}}>Create Repeat Set</div>
                <div className="ln-mockup-grid">
                  {[1,2,3,4,5,6].map(i=><div key={i} className="ln-mockup-tile"/>)}
                </div>
                <div style={{fontSize:'0.5rem',color:'#94a3b8',marginTop:'0.5rem',fontWeight:600,textTransform:'uppercase'}}>Variations</div>
                <div style={{display:'flex',gap:3,marginTop:3}}>
                  {[1,2,3,4].map(i=><div key={i} style={{width:36,height:36,borderRadius:4,background:`hsl(${260+i*20},60%,${88-i*3}%)`,border:'1px solid #e2e8f0'}}/>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services Cards */}
      <section className="ln-services" id="services">
        <div className="ln-services-grid">
          {SERVICES.map(s=>(
            <div key={s.name} className="ln-service-card" onClick={onEnterApp}>
              <div className="ln-service-icon"><SIcon d={s.icon}/></div>
              <div>
                <div className="ln-service-name">{s.name}</div>
                <div className="ln-service-desc">{s.desc}</div>
              </div>
              <span className="ln-service-arrow">→</span>
            </div>
          ))}
        </div>
      </section>

      {/* Workflow Steps */}
      <section className="ln-workflow">
        <div className="ln-workflow-inner">
          <div className="ln-workflow-upload">
            <div className="ln-upload-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
            </div>
            <div>
              <div style={{fontWeight:700,fontSize:'0.95rem'}}>Upload your artwork</div>
              <div style={{fontSize:'0.8rem',color:'#64748b'}}>Drag & drop an image here, or browse<br/>JPG, PNG, WEBP up to 25MB</div>
            </div>
          </div>
          <div className="ln-workflow-steps">
            {[
              {t:'AI-Powered Processing',d:'Our AI analyzes your artwork and prepares it for pattern creation.'},
              {t:'Seamless Results',d:'Get perfectly tiled, print-ready patterns every time.'},
              {t:'Export Anywhere',d:'Download in high-res PNG, JPG, or vector formats.'},
            ].map(s=>(
              <div key={s.t} className="ln-workflow-step">
                <div className="ln-step-dot">✓</div>
                <div>
                  <div style={{fontWeight:600,fontSize:'0.9rem'}}>{s.t}</div>
                  <div style={{fontSize:'0.8rem',color:'#64748b'}}>{s.d}</div>
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
            {BRANDS.map(b=><span key={b} className="ln-brand">{b}</span>)}
          </div>
        </div>
        <div className="ln-testimonial-row">
          <div className="ln-testimonial">
            <div className="ln-quote-mark">"</div>
            <p>RIM AI has transformed our workflow. We go from concept to print-ready pattern in minutes, not days.</p>
            <div className="ln-quote-author">— Sarah Lin, Creative Director at Pattern House</div>
          </div>
          <div className="ln-stats">
            <div className="ln-stat"><span className="ln-stat-num">10K+</span><span className="ln-stat-label">Designers Worldwide</span></div>
            <div className="ln-stat"><span className="ln-stat-num">2M+</span><span className="ln-stat-label">Patterns Generated</span></div>
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
  );
}
