export default function PrivacyPolicy() {
  return (
    <div
      style={{
        fontFamily: "'DM Sans', sans-serif",
        minHeight: "100vh",
        background: "#F5F6FF",
        padding: "0",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap');

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .pp-page {
          max-width: 950px;
          margin: 0 auto;
          padding: 2rem 1.5rem 4rem;
        }

        /* Hero */
        .pp-hero {
          background: linear-gradient(135deg, #5C6AC4 0%, #4959BD 60%, #3b4aab 100%);
          border-radius: 24px;
          padding: 3.5rem 3rem;
          margin-bottom: 2rem;
          position: relative;
          overflow: hidden;
        }

        .pp-hero::before {
          content: '';
          position: absolute;
          top: -80px;
          right: -80px;
          width: 280px;
          height: 280px;
          border-radius: 50%;
          background: rgba(255,255,255,0.06);
        }

        .pp-hero::after {
          content: '';
          position: absolute;
          bottom: -100px;
          right: 100px;
          width: 220px;
          height: 220px;
          border-radius: 50%;
          background: rgba(255,255,255,0.05);
        }

        .pp-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(255,255,255,0.14);
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 999px;
          margin-bottom: 1.5rem;
          letter-spacing: 0.04em;
          position: relative;
          z-index: 2;
        }

        .pp-hero h1 {
          font-family: 'DM Serif Display', serif;
          font-size: 3rem;
          font-weight: 400;
          line-height: 1.15;
          color: #fff;
          margin-bottom: 1rem;
          position: relative;
          z-index: 2;
        }

        .pp-hero p {
          color: rgba(255,255,255,0.82);
          font-size: 15px;
          line-height: 1.8;
          max-width: 620px;
          position: relative;
          z-index: 2;
        }

        /* Content */
        .pp-content {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .pp-card {
          background: #fff;
          border: 1px solid #E8E9F5;
          border-radius: 18px;
          padding: 2rem;
          transition: 0.2s ease;
        }

        .pp-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(0,0,0,0.04);
        }

        .pp-card h2 {
          font-size: 1.45rem;
          color: #2B2D42;
          margin-bottom: 1rem;
          font-weight: 700;
        }

        .pp-card h3 {
          font-size: 1rem;
          color: #5C6AC4;
          margin: 1.2rem 0 0.8rem;
          font-weight: 600;
        }

        .pp-card p {
          font-size: 14px;
          line-height: 1.9;
          color: #6B6F8A;
          margin-bottom: 1rem;
        }

        .pp-card ul {
          padding-left: 1.2rem;
        }

        .pp-card li {
          color: #6B6F8A;
          font-size: 14px;
          line-height: 1.9;
          margin-bottom: 0.5rem;
        }

        .pp-email {
          color: #5C6AC4;
          font-weight: 600;
          text-decoration: none;
        }

        .pp-footer {
          text-align: center;
          margin-top: 2rem;
          color: #8B8FA8;
          font-size: 13px;
        }

        @media (max-width: 768px) {
          .pp-page {
            padding: 1rem 1rem 3rem;
          }

          .pp-hero {
            padding: 2.5rem 1.5rem;
            border-radius: 18px;
          }

          .pp-hero h1 {
            font-size: 2.1rem;
          }

          .pp-card {
            padding: 1.5rem;
          }
        }
      `}</style>

      <div className="pp-page">

        {/* Hero */}
        <div className="pp-hero">
          <div className="pp-badge">
            PRIVACY & DATA PROTECTION
          </div>

          <h1>Privacy Policy for Rulex Discounts</h1>

          <p>
            Your privacy matters to us. This Privacy Policy explains how
            Rulex Discounts collects, uses, and protects information when
            merchants use our Shopify application.
            {/* <br /><br /> */}
            {/* Effective date: 2026-05-20 */}
          </p>
        </div>

        {/* Content */}
        <div className="pp-content">

          <div className="pp-card">
            <h2>1. Who We Are</h2>

            <p>
             We provides automatic
              quantity break and volume discount features for Shopify stores
              through the Rulex Discounts app ("the App").
            </p>

            <p>
              If you have any questions about this Privacy Policy, you can
              contact us at{" "}
              <a
                href="mailto:primedev026@gmail.com"
                className="pp-email"
              >
                primedev026@gmail.com
              </a>
            </p>
          </div>

          <div className="pp-card">
            <h2>2. Information We Collect</h2>

            <h3>From Merchants</h3>

            <ul>
              {/* <li>Name and email address</li> */}
              <li>Shopify store information such as store name and domain</li>
              <li>App usage and configuration settings</li>
            </ul>

            <h3>From Your Shopify Store</h3>

            <p>
              To provide the App’s functionality, we may access certain Shopify
              store data, including:
            </p>

            <ul>
              <li>Product and variant information</li>
              {/* <li>Collection information</li> */}
              <li>Discount configuration data</li>
              {/* <li>
                Cart and order-related information required to apply automatic
                discounts
              </li> */}
            </ul>
          </div>

          <div className="pp-card">
            <h2>3. How We Use Information</h2>

            <ul>
              <li>To provide and operate the App</li>
              <li>To create and manage quantity discount rules</li>
              <li>To apply automatic discounts based on cart quantities</li>
              <li>To provide customer support</li>
              <li>To improve App functionality and performance</li>
              <li>To comply with legal obligations</li>
            </ul>
          </div>

          <div className="pp-card">
            <h2>4. Sharing of Information</h2>

            <p>
              We do not sell merchant or customer data.
            </p>

            {/* <p>
              We may share information with trusted third-party service
              providers that help us operate the App, such as hosting,
              database, analytics, and support services. These providers only
              access information necessary to perform services on our behalf.
            </p> */}
          </div>

          <div className="pp-card">
            <h2>5. Data Retention</h2>

            <p>
              We retain store-related data only as long as necessary to provide
              the App and comply with legal obligations.
            </p>

            <p>
              When the App is uninstalled, related store data will be deleted.
            </p>
          </div>

          <div className="pp-card">
            <h2>6. Your Rights</h2>

            <p>
              Depending on your location, you may have rights to access,
              update, correct, or delete your data information.
            </p>

            <p>
              To make a request regarding your data, contact us at{" "}
              <a
                href="mailto:primedev026@gmail.com"
                className="pp-email"
              >
                primedev026@gmail.com
              </a>
            </p>
          </div>

          <div className="pp-card">
            <h2>7. Data Security</h2>

            <p>
              We take reasonable technical and organizational measures to
              protect your information against unauthorized access, loss,
              misuse, or disclosure.
            </p>
          </div>

          <div className="pp-card">
            <h2>8. Changes to This Policy</h2>

            <p>
              We may update this Privacy Policy from time to time. Any changes
              will be posted on this page with an updated effective date.
            </p>
          </div>

          <div className="pp-card">
            <h2>9. Contact</h2>

            <p>
              If you have questions about this Privacy Policy or data practices
              related to Rulex Discounts, contact us at:
            </p>

            <p>
              <a
                href="mailto:primedev026@gmail.com"
                className="pp-email"
              >
                primedev026@gmail.com
              </a>
            </p>
          </div>

        </div>

        {/* <div className="pp-footer">
          © 2026 Rulex Discounts. All rights reserved.
        </div> */}
      </div>
    </div>
  );
}