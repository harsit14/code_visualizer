import {
  ArrowRight,
  BrainCircuit,
  Code2,
  Database,
  Gauge,
  GraduationCap,
  Lock,
  Share2,
  Sparkles,
} from 'lucide-react';
import { AccountMenu } from './AccountMenu';

const screenshot = `${import.meta.env.BASE_URL}screenshots/dashboard-overview.png`;

const features = [
  {
    body: 'Step through Python, JavaScript, and TypeScript with active line highlighting and playback controls.',
    icon: Code2,
    title: 'Replay code execution',
  },
  {
    body: 'Inspect arrays, linked lists, trees, shared references, heap maps, variables, stdout, and call frames.',
    icon: Database,
    title: 'Visualize runtime state',
  },
  {
    body: 'Ask the hosted DeepSeek explainer to translate a selected trace step into beginner-friendly language.',
    icon: Sparkles,
    title: 'Explain each step',
  },
  {
    body: 'Export trace JSON, animated SVGs, shareable links, and iframe embeds for lessons and posts.',
    icon: Share2,
    title: 'Teach and publish',
  },
];

const recommendations = [
  'Terms, privacy, and AI data-use pages before paid launch.',
  'Admin dashboard for usage, subscriptions, support lookup, and abuse review.',
  'Email verification and password reset through a transactional email provider.',
  'Turnstile on signup once public traffic starts.',
];

export function LandingPage() {
  const openApp = () => {
    window.history.pushState(null, '', '/app');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <button className="landing-brand" onClick={openApp} type="button">
          <span className="brand-mark">⟢</span>
          <strong>Code Visualizer</strong>
        </button>
        <nav aria-label="Landing navigation">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <button onClick={openApp} type="button">
            Open dashboard
          </button>
          <AccountMenu compact />
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <p className="tour-kicker">Visual code execution for learners</p>
            <h1>Show what every line changes.</h1>
            <p>
              Code Visualizer turns short programs into replayable traces with data structures, call
              stacks, output, complexity signals, sharing, and AI explanations.
            </p>
            <div className="landing-actions">
              <button className="landing-primary" onClick={openApp} type="button">
                Try the dashboard
                <ArrowRight size={16} />
              </button>
              <a className="landing-secondary" href="#pricing">
                View plans
              </a>
            </div>
          </div>
          <figure className="landing-hero-figure">
            <img
              alt="Code Visualizer dashboard showing code, data, variables, and controls."
              src={screenshot}
            />
          </figure>
        </section>

        <section className="landing-section" id="features">
          <div className="landing-section-heading">
            <p className="tour-kicker">Features</p>
            <h2>Built for interview prep, classrooms, and technical writing.</h2>
          </div>
          <div className="landing-feature-grid">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article className="landing-feature" key={feature.title}>
                  <span className="tour-feature-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="landing-section landing-pricing" id="pricing">
          <div className="landing-section-heading">
            <p className="tour-kicker">Pricing</p>
            <h2>Start free, upgrade when AI explanations become part of your workflow.</h2>
          </div>
          <div className="pricing-grid">
            <article className="pricing-card">
              <h3>Free</h3>
              <p className="pricing-price">$0</p>
              <p>For trying examples, debugging small snippets, and sharing lightweight traces.</p>
              <ul>
                <li>
                  <Gauge size={15} /> Daily AI explanation limit
                </li>
                <li>
                  <Code2 size={15} /> Full dashboard and local tracing
                </li>
                <li>
                  <Share2 size={15} /> Share links and exports
                </li>
              </ul>
              <button onClick={openApp} type="button">
                Start free
              </button>
            </article>

            <article className="pricing-card pricing-card-featured">
              <h3>Pro</h3>
              <p className="pricing-price">Subscription</p>
              <p>For teachers, creators, and learners who use the AI explainer regularly.</p>
              <ul>
                <li>
                  <BrainCircuit size={15} /> Higher AI explanation quota
                </li>
                <li>
                  <GraduationCap size={15} /> Classroom-friendly embeds
                </li>
                <li>
                  <Lock size={15} /> Billing managed through Stripe
                </li>
              </ul>
              <AccountMenu />
            </article>
          </div>
        </section>

        <section className="landing-section launch-checklist">
          <div className="landing-section-heading">
            <p className="tour-kicker">Recommended Before Launch</p>
            <h2>Next public-use safeguards to add after the core account system.</h2>
          </div>
          <ul>
            {recommendations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
