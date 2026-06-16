import {
  ArrowRight,
  BrainCircuit,
  Code2,
  Database,
  Gauge,
  GraduationCap,
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

const moments = [
  {
    body: 'Pause on a line and see exactly which variables, pointers, frames, and outputs changed.',
    icon: BrainCircuit,
    title: 'Debug without the fog',
  },
  {
    body: 'Compare traces and complexity hints so loops, recursion, and growth rates become visible.',
    icon: Gauge,
    title: 'Feel the algorithm',
  },
  {
    body: 'Use share links, embeds, and animated exports to turn a small program into a clear lesson.',
    icon: GraduationCap,
    title: 'Teach from the trace',
  },
];

const visibleState = [
  'Variables',
  'Arrays',
  'Linked lists',
  'Trees',
  'Heap references',
  'Call stack',
  'Console output',
  'Complexity hints',
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
          <a href="#learn">For learners</a>
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
            <h1>Watch every line come alive.</h1>
            <p>
              Code Visualizer turns short programs into replayable traces, so learners can see data
              structures move, calls unfold, output appear, and confusing steps explained in plain
              language.
            </p>
            <div className="landing-actions">
              <button className="landing-primary" onClick={openApp} type="button">
                Start visualizing
                <ArrowRight size={16} />
              </button>
              <a className="landing-secondary" href="#features">
                Explore features
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
            <h2>A clearer way to learn what code actually does.</h2>
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

        <section className="landing-section landing-showcase" id="learn">
          <div className="landing-section-heading">
            <p className="tour-kicker">Inside the trace</p>
            <h2>Follow the story your program is already telling.</h2>
          </div>
          <div className="landing-state-grid">
            <div className="landing-state-copy">
              <p>
                Scrub through a run like a timeline. The editor, variables, data view, console, call
                stack, and explainer stay connected to the same moment, so nothing feels hidden.
              </p>
              <div className="landing-pill-list" aria-label="Visible runtime state">
                {visibleState.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
            <div className="landing-moment-grid">
              {moments.map((moment) => {
                const Icon = moment.icon;
                return (
                  <article className="landing-moment" key={moment.title}>
                    <span className="tour-feature-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <h3>{moment.title}</h3>
                    <p>{moment.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-section landing-final-cta">
          <h2>Paste a snippet. Press play. See the invisible parts.</h2>
          <button className="landing-primary" onClick={openApp} type="button">
            Open Code Visualizer
            <ArrowRight size={16} />
          </button>
        </section>
      </main>
    </div>
  );
}
