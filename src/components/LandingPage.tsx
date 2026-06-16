import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Clipboard,
  Code2,
  Database,
  Eye,
  Github,
  GraduationCap,
  Moon,
  Play,
  Presentation,
  Share2,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { AccountMenu } from './AccountMenu';
import { LandingInteractiveDemo } from './LandingInteractiveDemo';
import { LandingStructurePreview } from './LandingStructurePreview';

type Theme = 'light' | 'dark';
type StructureVisualKind = 'array' | 'list' | 'tree';

const GITHUB_URL = 'https://github.com/harsit14/code_visualizer';

const languageBadges = ['Python', 'JavaScript', 'TypeScript'];

const howItWorks = [
  {
    body: 'Start from a built-in example or paste a short algorithm you want to understand.',
    icon: Clipboard,
    title: 'Paste',
  },
  {
    body: 'Run it in the browser and scrub the recorded trace at your own pace.',
    icon: Play,
    title: 'Press play',
  },
  {
    body: 'Watch active lines, variables, pointers, calls, objects, and output update together.',
    icon: Eye,
    title: 'See the invisible parts',
  },
];

const traceHighlights = [
  {
    body: 'Line highlights, playback controls, and breakpoints keep every step grounded in code.',
    icon: Code2,
    title: 'Follow the active line',
  },
  {
    body: 'See which variables point to the same object, and spot mutations as they happen.',
    icon: Database,
    title: 'Untangle shared state',
  },
  {
    body: 'Ask for a plain-English explanation of any confusing step in the trace.',
    icon: Sparkles,
    title: 'Explain the moment',
  },
  {
    body: 'Share a runnable link or embed the trace directly in a lesson, note, or post.',
    icon: Share2,
    title: 'Teach from a trace',
  },
];

const structureVisuals: {
  body: string;
  kind: StructureVisualKind;
  title: string;
  previewKey: string;
}[] = [
  {
    body: 'Index markers and pointer variables move with the array cells they reference.',
    kind: 'array',
    previewKey: 'Arrays',
    title: 'Arrays',
  },
  {
    body: 'Node references make rewires, aliases, and next pointers visible.',
    kind: 'list',
    previewKey: 'Linked lists',
    title: 'Linked lists',
  },
  {
    body: 'Traversal paths and active nodes reveal the shape of recursive decisions.',
    kind: 'tree',
    previewKey: 'Trees',
    title: 'Trees',
  },
];

const audiences = [
  {
    body: 'Make loops, branches, and object references click without guessing from print output.',
    icon: GraduationCap,
    title: 'Students',
  },
  {
    body: 'Turn a small snippet into a replayable lesson with share links and embeds.',
    icon: Presentation,
    title: 'Educators',
  },
  {
    body: 'Practice algorithm traces, pointer movement, and state changes before the whiteboard.',
    icon: Users,
    title: 'Interview prep',
  },
];

const snippetPresets = [
  {
    code: `def reverse_list(head):
    prev = None
    curr = head
    while curr:
        nxt = curr.next
        curr.next = prev
        prev = curr
        curr = nxt
    return prev`,
    id: 'reverse-list',
    label: 'Reverse Linked List',
    result: '18 trace steps: prev, curr, and nxt move across the chain as each next link flips.',
    stat: 'linked list',
  },
  {
    code: `def inorder(root):
    if root is None:
        return []
    left = inorder(root.left)
    right = inorder(root.right)
    return left + [root.val] + right`,
    id: 'tree-traversal',
    label: 'Tree Traversal',
    result: '22 trace steps: recursive frames open and close while the active node moves through the tree.',
    stat: 'tree + stack',
  },
  {
    code: `def binary_search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1`,
    id: 'binary-search',
    label: 'Binary Search',
    result: '16 trace steps: lo, mid, and hi narrow the search space until the target is found.',
    stat: 'pointers',
  },
];

function initialTheme(): Theme {
  const stored = window.localStorage.getItem('cv-theme');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function LandingPage() {
  const [activePreview, setActivePreview] = useState('Arrays');
  const [activeSnippetId, setActiveSnippetId] = useState(snippetPresets[0].id);
  const [runCount, setRunCount] = useState(0);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const activeSnippet =
    snippetPresets.find((snippet) => snippet.id === activeSnippetId) ?? snippetPresets[0];

  const openApp = () => {
    window.history.pushState(null, '', '/app');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  useEffect(() => {
    document.documentElement.classList.add('landing-document');
    return () => {
      document.documentElement.classList.remove('landing-document');
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('cv-theme', theme);
  }, [theme]);

  useEffect(() => {
    const revealElements = [...document.querySelectorAll('.reveal')];
    if (!('IntersectionObserver' in window)) {
      revealElements.forEach((element) => element.classList.add('active-reveal'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('active-reveal');
          }
        });
      },
      { threshold: 0.04 },
    );

    revealElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));

  return (
    <div className="landing-page">
      <header className="landing-nav reveal">
        <button className="landing-brand" onClick={openApp} type="button">
          <span className="brand-mark">⟢</span>
          <strong>Code Visualizer</strong>
        </button>
        <nav aria-label="Landing navigation">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#try">Try it</a>
          <a href={GITHUB_URL} rel="noreferrer" target="_blank">
            <Github size={14} />
            GitHub
          </a>
          <button className="landing-nav-cta" onClick={openApp} type="button">
            Open dashboard
          </button>
          <button
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="landing-icon-button"
            onClick={toggleTheme}
            type="button"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <AccountMenu compact />
        </nav>
      </header>

      <main>
        <section className="landing-hero reveal">
          <div className="landing-hero-copy">
            <p className="tour-kicker">Live trace demo</p>
            <h1>See your code run, line by line.</h1>
            <p className="landing-hero-lede">
              Watch every variable, pointer, call, and output update as the program moves through
              a replayable timeline.
            </p>
            <p className="landing-category-line">
              An in-browser visual debugger for Python, JavaScript, and TypeScript.
            </p>
            <div className="landing-language-badges" aria-label="Supported languages">
              {languageBadges.map((language) => (
                <span key={language}>{language}</span>
              ))}
            </div>
            <div className="landing-actions">
              <button className="landing-primary" onClick={openApp} type="button">
                Start visualizing
                <ArrowRight size={16} />
              </button>
              <a className="landing-secondary" href="#try">
                Try a preset
              </a>
            </div>
          </div>
          <div className="landing-hero-demo">
            <LandingInteractiveDemo />
          </div>
        </section>

        <section className="landing-section landing-flow-section reveal" id="how">
          <div className="landing-section-heading">
            <p className="tour-kicker">How it works</p>
            <h2>Paste. Press play. See the invisible parts.</h2>
          </div>
          <div className="landing-flow-grid">
            {howItWorks.map((step, index) => {
              const Icon = step.icon;
              return (
                <article className="landing-flow-step" key={step.title}>
                  <span className="landing-flow-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="tour-feature-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="landing-section landing-showcase reveal" id="features">
          <div className="landing-section-heading">
            <p className="tour-kicker">Features</p>
            <h2>Everything your program hides becomes visible.</h2>
          </div>

          <div className="landing-proof-grid">
            {traceHighlights.map((feature) => {
              const Icon = feature.icon;
              return (
                <article className="landing-proof-card" key={feature.title}>
                  <span className="tour-feature-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              );
            })}
          </div>

          <div className="landing-state-grid">
            <div className="landing-structure-list" aria-label="Data structure previews">
              {structureVisuals.map((item) => (
                <button
                  aria-pressed={activePreview === item.previewKey}
                  className={`landing-structure-card ${
                    activePreview === item.previewKey ? 'active-structure' : ''
                  }`}
                  key={item.title}
                  onClick={() => setActivePreview(item.previewKey)}
                  onMouseEnter={() => setActivePreview(item.previewKey)}
                  type="button"
                >
                  <StructureMiniVisual kind={item.kind} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="landing-state-preview-panel">
              <LandingStructurePreview activeItem={activePreview} />
            </div>
          </div>
        </section>

        <section className="landing-section landing-try-section reveal" id="try">
          <div className="landing-section-heading">
            <p className="tour-kicker">Try it without leaving</p>
            <h2>Pick a familiar snippet and preview the kind of trace it produces.</h2>
          </div>
          <div className="landing-snippet-lab">
            <div className="landing-snippet-tabs" role="tablist" aria-label="Preset snippets">
              {snippetPresets.map((snippet) => (
                <button
                  aria-selected={activeSnippet.id === snippet.id}
                  className={activeSnippet.id === snippet.id ? 'active-snippet' : ''}
                  key={snippet.id}
                  onClick={() => {
                    setActiveSnippetId(snippet.id);
                    setRunCount((count) => count + 1);
                  }}
                  role="tab"
                  type="button"
                >
                  <span>{snippet.label}</span>
                  <small>{snippet.stat}</small>
                </button>
              ))}
            </div>
            <pre className="landing-snippet-code">
              <code>{activeSnippet.code}</code>
            </pre>
            <div className="landing-run-panel" key={`${activeSnippet.id}-${runCount}`}>
              <div>
                <span className="landing-run-label">Preview output</span>
                <p>{activeSnippet.result}</p>
              </div>
              <div className="landing-run-actions">
                <button
                  className="landing-secondary"
                  onClick={() => setRunCount((count) => count + 1)}
                  type="button"
                >
                  <Play size={15} />
                  Run preview
                </button>
                <button className="landing-primary" onClick={openApp} type="button">
                  Open full visualizer
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section landing-audience-section reveal">
          <div className="landing-audience-inner">
            <div className="landing-audience-heading">
              <p className="tour-kicker">Who it is for</p>
              <h2>Built for the moments when code is correct but still hard to see.</h2>
            </div>
            <div className="landing-audience-strip">
              {audiences.map((audience) => {
                const Icon = audience.icon;
                return (
                  <article className="landing-audience-card" key={audience.title}>
                    <span className="tour-feature-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <h3>{audience.title}</h3>
                    <p>{audience.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-section landing-final-cta reveal">
          <div>
            <p className="tour-kicker">Ready when you are</p>
            <h2>Open the dashboard and make the next confusing step visible.</h2>
          </div>
          <button className="landing-primary" onClick={openApp} type="button">
            Open Code Visualizer
            <ArrowRight size={16} />
          </button>
        </section>
      </main>

      <footer className="landing-footer reveal">
        <button className="landing-footer-brand" onClick={openApp} type="button">
          <span className="brand-mark">⟢</span>
          <span>Code Visualizer</span>
        </button>
        <div className="landing-footer-links">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#try">Try it</a>
          <a href={GITHUB_URL} rel="noreferrer" target="_blank">
            <Github size={14} />
            GitHub
          </a>
          <button onClick={toggleTheme} type="button">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </footer>
    </div>
  );
}

function StructureMiniVisual({ kind }: { kind: StructureVisualKind }) {
  if (kind === 'array') {
    return (
      <span className="mini-visual mini-array" aria-hidden="true">
        {[2, 7, 11, 15].map((value, index) => (
          <i className={index === 1 ? 'active-mini-cell' : ''} key={value}>
            {value}
          </i>
        ))}
      </span>
    );
  }

  if (kind === 'list') {
    return (
      <span className="mini-visual mini-list" aria-hidden="true">
        <i>10</i>
        <b />
        <i className="active-mini-cell">20</i>
        <b />
        <i>30</i>
      </span>
    );
  }

  return (
    <span className="mini-visual mini-tree" aria-hidden="true">
      <svg viewBox="0 0 120 68">
        <line x1="60" y1="14" x2="32" y2="40" />
        <line x1="60" y1="14" x2="88" y2="40" />
        <circle cx="60" cy="14" r="10" />
        <circle className="active-tree-node" cx="32" cy="40" r="10" />
        <circle cx="88" cy="40" r="10" />
      </svg>
    </span>
  );
}
