import {
  BookOpen,
  Code2,
  Database,
  FileImage,
  Gauge,
  GitBranch,
  Lock,
  Play,
  Share2,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

type TourMetric = {
  label: string;
  value: string;
};

type TourFeature = {
  body: string;
  icon: LucideIcon;
  title: string;
};

type TourSection = {
  body: string;
  caption: string;
  features: TourFeature[];
  image: string;
  imageAlt: string;
  kicker: string;
  title: string;
};

const screenshotPath = (filename: string) => `${import.meta.env.BASE_URL}screenshots/${filename}`;

const metrics: TourMetric[] = [
  { label: 'Languages', value: 'Python, JS, TS' },
  { label: 'Trace views', value: 'Code + data + stack' },
  { label: 'Sharing', value: 'Links, embeds, SVG' },
];

const sections: TourSection[] = [
  {
    body: 'Step through real code while the editor, runtime controls, variables, output, and data views stay in sync.',
    caption:
      'The dashboard keeps the active line, trace position, data state, and controls visible together.',
    features: [
      {
        body: 'Run, pause, scrub, step forward or back, and jump to breakpoints or the cursor line.',
        icon: Play,
        title: 'Trace playback',
      },
      {
        body: 'Use built-in examples or paste custom Python, JavaScript, and TypeScript snippets.',
        icon: Code2,
        title: 'Multi-language editor',
      },
    ],
    image: 'dashboard-overview.png',
    imageAlt: 'Code Visualizer dashboard with editor, data panels, variables, and controls.',
    kicker: 'Dashboard',
    title: 'A complete execution workbench in one screen',
  },
  {
    body: 'Collections and object references are rendered visually so learners can see the structure behind each variable.',
    caption:
      'Arrays, linked lists, trees, heap objects, and shared references update as the trace moves.',
    features: [
      {
        body: 'Array pointer hints reveal indices such as left, right, mid, slow, fast, and loop counters.',
        icon: Database,
        title: 'Data structures',
      },
      {
        body: 'The heap map makes aliases and nested references visible instead of hiding them inside repr strings.',
        icon: GitBranch,
        title: 'Memory map',
      },
    ],
    image: 'data-structures.png',
    imageAlt: 'Data panel showing arrays, pointers, heap nodes, and shared references.',
    kicker: 'Data Views',
    title: 'Understand what values point to',
  },
  {
    body: 'Recursive calls get a persistent call tree, while the AI explainer can translate the current trace step into plain language.',
    caption:
      'The current frame, locals, changed variables, and full code context are used to explain the selected step.',
    features: [
      {
        body: 'See recursive calls branch and return without losing the history of how the call tree was built.',
        icon: BookOpen,
        title: 'Recursive call tree',
      },
      {
        body: 'Click once to ask the hosted DeepSeek explainer what changed on the active line and why.',
        icon: Sparkles,
        title: 'AI step explainer',
      },
    ],
    image: 'ai-explainer.png',
    imageAlt: 'Explainer panel and call tree for a recursive trace.',
    kicker: 'Guided Learning',
    title: 'Pair visual state with a natural-language explanation',
  },
  {
    body: 'The same trace can become a classroom link, an embedded course widget, a JSON replay, or a lightweight animated SVG.',
    caption:
      'Export and sharing controls are built into the top bar so examples can travel with the lesson.',
    features: [
      {
        body: 'Copy share links and iframe snippets for blogs, notes, LMS pages, and slide decks.',
        icon: Share2,
        title: 'Share and embed',
      },
      {
        body: 'Export trace JSON for replay or animated SVG for offline material and social posts.',
        icon: FileImage,
        title: 'Portable traces',
      },
    ],
    image: 'share-export.png',
    imageAlt: 'Top bar showing share, embed, export, and SVG trace actions.',
    kicker: 'Publishing',
    title: 'Turn a trace into teaching material',
  },
];

const audienceFeatures: TourFeature[] = [
  {
    body: 'Trace interview-style functions without writing harness code or print debugging every loop.',
    icon: Gauge,
    title: 'Interview prep',
  },
  {
    body: 'Use visual examples to explain loops, recursion, references, runtime errors, and complexity tradeoffs.',
    icon: Users,
    title: 'Classrooms',
  },
  {
    body: 'The hosted explainer keeps provider keys server-side, so learners never paste an API key into the browser.',
    icon: Lock,
    title: 'Hosted safely',
  },
];

export function ProductTour() {
  return (
    <section className="product-tour" aria-labelledby="product-tour-title">
      <div className="tour-inner">
        <header className="tour-intro">
          <div>
            <p className="tour-kicker">Why Code Visualizer</p>
            <h2 id="product-tour-title">See code execute, not just finish.</h2>
          </div>
          <p>
            Code Visualizer turns short programs into replayable traces: active lines, variables,
            call frames, data structures, output, complexity signals, and AI explanations all move
            together.
          </p>
        </header>

        <div className="tour-metrics" aria-label="Product highlights">
          {metrics.map((metric) => (
            <div className="tour-metric" key={metric.label}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>

        <div className="tour-sections">
          {sections.map((section, index) => (
            <article
              className={`tour-section${index % 2 === 1 ? ' tour-section-reverse' : ''}`}
              key={section.title}
            >
              <div className="tour-copy">
                <p className="tour-kicker">{section.kicker}</p>
                <h3>{section.title}</h3>
                <p>{section.body}</p>
                <div className="tour-feature-list">
                  {section.features.map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <div className="tour-feature" key={feature.title}>
                        <span className="tour-feature-icon" aria-hidden="true">
                          <Icon size={17} />
                        </span>
                        <div>
                          <h4>{feature.title}</h4>
                          <p>{feature.body}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <figure className="tour-figure">
                <img alt={section.imageAlt} loading="lazy" src={screenshotPath(section.image)} />
                <figcaption>{section.caption}</figcaption>
              </figure>
            </article>
          ))}
        </div>

        <footer className="tour-audience">
          <div>
            <p className="tour-kicker">Built For</p>
            <h3>Students, teachers, and technical writers.</h3>
          </div>
          <div className="tour-audience-grid">
            {audienceFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <article className="tour-audience-card" key={feature.title}>
                  <span className="tour-feature-icon" aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <h4>{feature.title}</h4>
                  <p>{feature.body}</p>
                </article>
              );
            })}
          </div>
        </footer>
      </div>
    </section>
  );
}
