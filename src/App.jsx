import "./App.css";
import { useState } from "react";
import { apiRequest } from "./api";
import Masonry from "react-masonry-css";
import { useNavigate } from "react-router-dom";
import { useRef } from "react";

function Navbar() {
  const navigate = useNavigate();
  const logoRef = useRef();
  let pressTimer = useRef();
  const [holding, setHolding] = useState(false);

  const handleLogoMouseDown = () => {
    setHolding(true);
    pressTimer.current = setTimeout(() => {
      setHolding(false);
      navigate("/admin");
    }, 2000);
  };
  const handleLogoMouseUp = () => {
    setHolding(false);
    clearTimeout(pressTimer.current);
  };
  const handleLogoMouseLeave = () => {
    setHolding(false);
    clearTimeout(pressTimer.current);
  };

  return (
    <nav className="ck-navbar" aria-label="Main navigation">
      <div className="ck-navbar-inner">
        <div
          className={`ck-logo${holding ? " ck-logo-hold" : ""}`}
          ref={logoRef}
          onMouseDown={handleLogoMouseDown}
          onMouseUp={handleLogoMouseUp}
          onMouseLeave={handleLogoMouseLeave}
          onTouchStart={handleLogoMouseDown}
          onTouchEnd={handleLogoMouseUp}
          tabIndex={0}
          aria-label="Go to homepage (long press for admin)"
          role="button"
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleLogoMouseDown(); }}
          onKeyUp={e => { if (e.key === 'Enter' || e.key === ' ') handleLogoMouseUp(); }}
        >
          Cubekrafts
        </div>
        <div className="ck-nav-links">
          <a href="#" className="ck-nav-link" aria-label="Home">Home</a>
          <a href="#products" className="ck-nav-link" aria-label="Products">Products</a>
          <a href="#roi" className="ck-nav-link" aria-label="ROI Calculator">ROI Calculator</a>
          <a href="#contact" className="ck-nav-link" aria-label="Contact">Contact</a>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <div className="ck-root">
      <Navbar />
      <header className="ck-hero">
        <div className="ck-hero-content">
          <h1>Modular Construction, Delivered.</h1>
          <p className="ck-hero-sub">Pre-fabricated modular units for homes, schools, and emergency shelters.</p>
        </div>
      </header>
      <main className="ck-main">
        <section className="ck-how">
          <h2>How It Works</h2>
          <div className="ck-how-steps">
            <div className="ck-how-step">
              <div className="ck-how-icon">🧩</div>
              <h3>1. Choose Your Module</h3>
              <p>Select from our range of modular kitchens, bathrooms, pods, and more.</p>
            </div>
            <div className="ck-how-step">
              <div className="ck-how-icon">🏭</div>
              <h3>2. We Prefabricate</h3>
              <p>Your unit is built off-site in our advanced facility for quality and speed.</p>
            </div>
            <div className="ck-how-step">
              <div className="ck-how-icon">🚚</div>
              <h3>3. Delivered & Installed</h3>
              <p>We deliver and install your module, ready to use in days, not months.</p>
            </div>
          </div>
        </section>
        <section className="ck-products" id="products">
          <h2>Our Products</h2>
          <Masonry
            breakpointCols={{ default: 4, 1100: 3, 700: 2, 500: 1 }}
            className="ck-masonry-grid"
            columnClassName="ck-masonry-col"
          >
            <div className="ck-product-card" style={{ minHeight: 220 }}>
              <div className="ck-product-icon">🍳</div>
              <h3>Kitchen Pod</h3>
              <p>Fully-equipped modular kitchens, ready to install in any space. Premium finishes, smart storage, and chef-grade appliances for a luxury experience.</p>
            </div>
            <div className="ck-product-card" style={{ minHeight: 260 }}>
              <div className="ck-product-icon">🛁</div>
              <h3>Bath Module</h3>
              <p>Modern, self-contained bathrooms for homes, hotels, or offices. Spa-inspired fixtures, rain showers, and seamless installation.</p>
            </div>
            <div className="ck-product-card" style={{ minHeight: 180 }}>
              <div className="ck-product-icon">🏫</div>
              <h3>School Unit</h3>
              <p>Rapidly deployable classroom units for schools and learning centers. Bright, safe, and energy-efficient spaces for learning.</p>
            </div>
            <div className="ck-product-card" style={{ minHeight: 240 }}>
              <div className="ck-product-icon">⛑️</div>
              <h3>Emergency Shelter</h3>
              <p>Durable, quick-setup shelters for disaster relief and emergencies. Secure, climate-controlled, and ready in hours.</p>
            </div>
          </Masonry>
        </section>
        <section className="ck-benefits">
          <h2>Why Choose Cubekrafts?</h2>
          <div className="ck-benefit-cards">
            <div className="ck-benefit-card">
              <div className="ck-benefit-icon">⚡</div>
              <h3>Speed</h3>
              <p>Get your modular unit delivered and installed in days, not months.</p>
            </div>
            <div className="ck-benefit-card">
              <div className="ck-benefit-icon">🌱</div>
              <h3>Sustainability</h3>
              <p>Eco-friendly materials and processes for a greener tomorrow.</p>
            </div>
            <div className="ck-benefit-card">
              <div className="ck-benefit-icon">💸</div>
              <h3>Cost Savings</h3>
              <p>Save on construction costs with efficient, prefabricated solutions.</p>
            </div>
          </div>
        </section>
        <section className="ck-clients">
          <h2>Our Clients</h2>
          <div className="ck-client-logos">
            <div className="ck-client-logo">
              <span role="img" aria-label="Government">🏛️</span>
              <p>Government</p>
            </div>
            <div className="ck-client-logo">
              <span role="img" aria-label="NGO">🤝</span>
              <p>NGO</p>
            </div>
            <div className="ck-client-logo">
              <span role="img" aria-label="Hospitality">🏨</span>
              <p>Hospitality</p>
            </div>
            <div className="ck-client-logo">
              <span role="img" aria-label="Real Estate">🏢</span>
              <p>Real Estate</p>
            </div>
          </div>
        </section>
        <section className="ck-contact" id="contact">
          <h2>Contact Us</h2>
          <ContactForm />
        </section>
        <section className="ck-roi" id="roi">
          <h2>Prefab ROI Calculator</h2>
          <ROICalculator />
        </section>
      </main>
      <footer className="ck-footer">
        &copy; {new Date().getFullYear()} Cubekrafts. All rights reserved.
      </footer>
    </div>
  );
}

function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", location: "", message: "" });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    try {
      await apiRequest("/api/inquiries", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setStatus({ type: "success", msg: "Thank you! We'll be in touch soon." });
      setForm({ name: "", email: "", location: "", message: "" });
    } catch (err) {
      setStatus({ type: "error", msg: err?.error || "Submission failed. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="ck-contact-form" onSubmit={handleSubmit} role="form" aria-labelledby="contactFormTitle">
      <h2 id="contactFormTitle" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>Contact Form</h2>
      <div className="ck-form-row">
        <label htmlFor="contact-name" className="visually-hidden">Name</label>
        <input
          id="contact-name"
          name="name"
          type="text"
          placeholder="Name"
          value={form.name}
          onChange={handleChange}
          required
          aria-required="true"
        />
        <label htmlFor="contact-email" className="visually-hidden">Email</label>
        <input
          id="contact-email"
          name="email"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          required
          aria-required="true"
        />
      </div>
      <div className="ck-form-row">
        <label htmlFor="contact-location" className="visually-hidden">Location</label>
        <input
          id="contact-location"
          name="location"
          type="text"
          placeholder="Location"
          value={form.location}
          onChange={handleChange}
          required
          aria-required="true"
        />
      </div>
      <div className="ck-form-row">
        <label htmlFor="contact-message" className="visually-hidden">Message</label>
        <textarea
          id="contact-message"
          name="message"
          placeholder="Message"
          value={form.message}
          onChange={handleChange}
          required
          aria-required="true"
          rows={4}
        />
      </div>
      <button type="submit" disabled={loading} aria-busy={loading} aria-label="Send Inquiry">
        {loading ? "Sending..." : "Send Inquiry"}
        </button>
      {status && (
        <div className={`ck-form-status ${status.type}`} aria-live="polite">{status.msg}</div>
      )}
    </form>
  );
}

function ROICalculator() {
  const [inputs, setInputs] = useState({ sqft: "", module: "kitchen", cost: "", time: "" });
  const [result, setResult] = useState(null);

  const moduleData = {
    kitchen: { tradCost: 2500, tradTime: 30 },
    bath: { tradCost: 2000, tradTime: 25 },
    school: { tradCost: 1500, tradTime: 20 },
    shelter: { tradCost: 1200, tradTime: 15 },
  };

  const handleChange = (e) => {
    setInputs({ ...inputs, [e.target.name]: e.target.value });
  };

  const handleCalculate = (e) => {
    e.preventDefault();
    const sqft = parseFloat(inputs.sqft);
    const cost = parseFloat(inputs.cost);
    const time = parseFloat(inputs.time);
    if (!sqft || !cost || !time) return setResult(null);
    const { tradCost, tradTime } = moduleData[inputs.module];
    const traditionalTotal = sqft * tradCost;
    const prefabTotal = sqft * cost;
    const costSavings = traditionalTotal - prefabTotal;
    const timeSavings = tradTime - time;
    setResult({ costSavings, timeSavings, traditionalTotal, prefabTotal });
  };

  return (
    <form className="ck-roi-form" onSubmit={handleCalculate} role="form" aria-labelledby="roiFormTitle">
      <h2 id="roiFormTitle" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>ROI Calculator</h2>
      <div className="ck-form-row">
        <label htmlFor="roi-sqft" className="visually-hidden">Sqft</label>
        <input
          id="roi-sqft"
          name="sqft"
          type="number"
          min="1"
          placeholder="Sqft"
          value={inputs.sqft}
          onChange={handleChange}
          required
          aria-required="true"
        />
        <label htmlFor="roi-module" className="visually-hidden">Module</label>
        <select id="roi-module" name="module" value={inputs.module} onChange={handleChange} aria-label="Module">
          <option value="kitchen">Kitchen Pod</option>
          <option value="bath">Bath Module</option>
          <option value="school">School Unit</option>
          <option value="shelter">Emergency Shelter</option>
        </select>
      </div>
      <div className="ck-form-row">
        <label htmlFor="roi-cost" className="visually-hidden">Prefab Cost/Sqft</label>
        <input
          id="roi-cost"
          name="cost"
          type="number"
          min="1"
          placeholder="Prefab Cost/Sqft"
          value={inputs.cost}
          onChange={handleChange}
          required
          aria-required="true"
        />
        <label htmlFor="roi-time" className="visually-hidden">Prefab Time (days)</label>
        <input
          id="roi-time"
          name="time"
          type="number"
          min="1"
          placeholder="Prefab Time (days)"
          value={inputs.time}
          onChange={handleChange}
          required
          aria-required="true"
        />
      </div>
      <button type="submit" aria-label="Calculate ROI">Calculate ROI</button>
      {result && (
        <div className="ck-roi-result" aria-live="polite">
          <p><b>Traditional Cost:</b> ₹{result.traditionalTotal.toLocaleString()}</p>
          <p><b>Prefab Cost:</b> ₹{result.prefabTotal.toLocaleString()}</p>
          <p><b>Cost Savings:</b> <span style={{ color: result.costSavings > 0 ? '#1b7e3c' : '#b00020' }}>₹{result.costSavings.toLocaleString()}</span></p>
          <p><b>Time Savings:</b> <span style={{ color: result.timeSavings > 0 ? '#1b7e3c' : '#b00020' }}>{result.timeSavings} days</span></p>
        </div>
      )}
    </form>
  );
}
