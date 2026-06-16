import { ArrowRight } from 'lucide-react';

type StructurePreviewProps = {
  activeItem: string;
};

export function LandingStructurePreview({ activeItem }: StructurePreviewProps) {
  const itemKey = activeItem.toLowerCase();

  switch (itemKey) {
    case 'variables':
      return (
        <div className="structure-preview-content vars-preview animate-fade-in">
          <div className="preview-header-bar">
            <span>Local Scope Variables</span>
            <span className="preview-status-badge">changed lines highlighted</span>
          </div>
          <div className="vars-container">
            <div className="var-row">
              <span className="var-name">nums</span>
              <span className="var-type">list</span>
              <span className="var-val">[2, 7, 11, 15]</span>
            </div>
            <div className="var-row">
              <span className="var-name">target</span>
              <span className="var-type">int</span>
              <span className="var-val">9</span>
            </div>
            <div className="var-row var-changed">
              <span className="var-name">i</span>
              <span className="var-type">int</span>
              <span className="var-val">1</span>
              <span className="change-indicator">updated</span>
            </div>
            <div className="var-row var-changed">
              <span className="var-name">seen</span>
              <span className="var-type">dict</span>
              <span className="var-val">{"{2: 0}"}</span>
              <span className="change-indicator">updated</span>
            </div>
            <div className="var-row">
              <span className="var-name">complement</span>
              <span className="var-type">int</span>
              <span className="var-val">7</span>
            </div>
          </div>
        </div>
      );

    case 'arrays':
      return (
        <div className="structure-preview-content array-preview animate-fade-in">
          <div className="preview-header-bar">
            <span>Array View (Index Tracking)</span>
          </div>
          <div className="array-preview-container">
            <div className="array-label-row">
              <span className="array-marker-label marker-lo" style={{ left: '20%' }}>lo</span>
              <span className="array-marker-label marker-mid" style={{ left: '50%' }}>mid</span>
              <span className="array-marker-label marker-hi" style={{ left: '80%' }}>hi</span>
            </div>
            <div className="visual-array">
              {[12, 16, 22, 30, 45, 55, 68, 90].map((val, idx) => {
                let activeClass = '';
                if (idx === 1) activeClass = 'lo-border';
                if (idx === 3) activeClass = 'mid-border';
                if (idx === 6) activeClass = 'hi-border';
                return (
                  <div className={`array-cell ${activeClass}`} key={idx}>
                    <span className="cell-idx-label">{idx}</span>
                    <span className="cell-val-label">{val}</span>
                  </div>
                );
              })}
            </div>
            <p className="preview-caption">
              Pointer variables like <code>lo</code>, <code>mid</code>, and <code>hi</code> automatically attach to indices.
            </p>
          </div>
        </div>
      );

    case 'linked lists':
      return (
        <div className="structure-preview-content list-preview animate-fade-in">
          <div className="preview-header-bar">
            <span>Linked List rewire trace</span>
          </div>
          <div className="list-preview-container">
            <div className="list-pointers">
              <span className="list-pointer-tag prev-tag" style={{ left: '15%' }}>prev</span>
              <span className="list-pointer-tag curr-tag" style={{ left: '51%' }}>curr</span>
              <span className="list-pointer-tag next-tag" style={{ left: '85%' }}>nxt</span>
            </div>
            <div className="list-nodes">
              <div className="list-node">
                <span className="node-val">10</span>
                <span className="node-next-dot">•</span>
              </div>
              <div className="list-arrow-connector">
                <ArrowRight size={14} />
              </div>
              <div className="list-node active-node">
                <span className="node-val">20</span>
                <span className="node-next-dot">•</span>
              </div>
              <div className="list-arrow-connector">
                <ArrowRight size={14} className="animating-arrow" />
              </div>
              <div className="list-node">
                <span className="node-val">30</span>
                <span className="node-next-dot">•</span>
              </div>
              <div className="list-arrow-connector">
                <ArrowRight size={14} />
              </div>
              <div className="list-node null-node">
                <span className="node-val">Ø</span>
              </div>
            </div>
            <p className="preview-caption">
              Watch nodes rewire, values change, and aliases follow reference chains step by step.
            </p>
          </div>
        </div>
      );

    case 'trees':
      return (
        <div className="structure-preview-content tree-preview animate-fade-in">
          <div className="preview-header-bar">
            <span>Binary Search Tree</span>
          </div>
          <div className="tree-preview-container">
            <svg viewBox="0 0 320 180" className="tree-svg">
              {/* Lines connecting nodes */}
              <line x1="160" y1="35" x2="90" y2="85" stroke="var(--border-strong)" strokeWidth="2" />
              <line x1="160" y1="35" x2="230" y2="85" stroke="var(--border-strong)" strokeWidth="2" />
              <line x1="90" y1="85" x2="50" y2="135" stroke="var(--border-strong)" strokeWidth="2" />
              <line x1="90" y1="85" x2="130" y2="135" stroke="var(--border-strong)" strokeWidth="2" />

              {/* Traversal path trace overlay */}
              <path d="M 160 35 L 90 85 L 130 135" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 3" className="tree-path-trace" />

              {/* Node Groups */}
              {/* Root */}
              <g transform="translate(160, 35)">
                <circle r="16" fill="var(--bg-raised)" stroke="var(--border-strong)" strokeWidth="2" />
                <text textAnchor="middle" dy="4" fill="var(--text)" fontSize="11" fontWeight="bold">12</text>
              </g>

              {/* Level 2 */}
              <g transform="translate(90, 85)">
                <circle r="16" fill="var(--bg-raised)" stroke="var(--accent)" strokeWidth="2" className="highlighted-circle" />
                <text textAnchor="middle" dy="4" fill="var(--text)" fontSize="11" fontWeight="bold">7</text>
                <text textAnchor="middle" y="28" fill="var(--accent)" fontSize="9" fontWeight="bold">curr</text>
              </g>
              <g transform="translate(230, 85)">
                <circle r="16" fill="var(--bg-raised)" stroke="var(--border-strong)" strokeWidth="2" />
                <text textAnchor="middle" dy="4" fill="var(--text)" fontSize="11" fontWeight="bold">18</text>
              </g>

              {/* Level 3 */}
              <g transform="translate(50, 135)">
                <circle r="14" fill="var(--bg-raised)" stroke="var(--border-strong)" strokeWidth="2" />
                <text textAnchor="middle" dy="4" fill="var(--text-dim)" fontSize="10">3</text>
              </g>
              <g transform="translate(130, 135)">
                <circle r="14" fill="var(--bg-raised)" stroke="var(--border-strong)" strokeWidth="2" />
                <text textAnchor="middle" dy="4" fill="var(--text-dim)" fontSize="10">9</text>
              </g>
            </svg>
            <p className="preview-caption">
              Visualizes binary search trees with highlighted traversal routes and active nodes.
            </p>
          </div>
        </div>
      );

    case 'heap references':
      return (
        <div className="structure-preview-content heap-preview animate-fade-in">
          <div className="preview-header-bar">
            <span>Heap memory mapper</span>
          </div>
          <div className="heap-preview-container">
            <div className="heap-stack-col">
              <span className="heap-col-label">Variables (Stack)</span>
              <div className="heap-box">
                <span className="h-name">head</span>
                <span className="h-arrow">➔</span>
                <span className="h-ref">Node @1a</span>
              </div>
              <div className="heap-box">
                <span className="h-name">curr</span>
                <span className="h-arrow">➔</span>
                <span className="h-ref">Node @2b</span>
              </div>
            </div>
            <div className="heap-map-col">
              <span className="heap-col-label">Objects (Heap)</span>
              <div className="heap-object">
                <div className="heap-obj-header">Node @1a</div>
                <div className="heap-obj-body">
                  <div>val: 10</div>
                  <div>next: <span className="ref-link">➔ @2b</span></div>
                </div>
              </div>
              <div className="heap-object active-object">
                <div className="heap-obj-header">Node @2b</div>
                <div className="heap-obj-body">
                  <div>val: 20</div>
                  <div>next: <span className="ref-link">➔ null</span></div>
                </div>
              </div>
            </div>
          </div>
          <p className="preview-caption">
            Untangle references, object aliases, and heap mutations with a connected memory map.
          </p>
        </div>
      );

    case 'call stack':
      return (
        <div className="structure-preview-content stack-preview animate-fade-in">
          <div className="preview-header-bar">
            <span>Recursive call tree</span>
          </div>
          <div className="stack-preview-container">
            <div className="call-stack-list">
              <div className="stack-frame top-frame">
                <div className="frame-func">solve(n=2)</div>
                <div className="frame-vars">mid=1, ans=1</div>
              </div>
              <div className="stack-frame">
                <div className="frame-func">solve(n=3)</div>
                <div className="frame-vars">mid=2, ans=?</div>
              </div>
              <div className="stack-frame">
                <div className="frame-func">solve(n=4)</div>
                <div className="frame-vars">mid=3, ans=?</div>
              </div>
              <div className="stack-frame base-frame">
                <div className="frame-func">&lt;module&gt; (global)</div>
                <div className="frame-vars">arr=[1, 3, 5], ans=?</div>
              </div>
            </div>
            <p className="preview-caption">
              Observe recursive depth growth and local stack frame contexts swap instantly on hover.
            </p>
          </div>
        </div>
      );

    case 'console output':
      return (
        <div className="structure-preview-content console-preview animate-fade-in">
          <div className="preview-header-bar">
            <span>Stdout Console</span>
          </div>
          <div className="console-preview-container">
            <div className="console-lines">
              <div className="c-line">&gt; Starting factorial tracer...</div>
              <div className="c-line">[Log] n = 5, entering factorial</div>
              <div className="c-line">[Log] n = 4, entering factorial</div>
              <div className="c-line">[Log] n = 3, entering factorial</div>
              <div className="c-line">[Log] n = 2, base case reached</div>
              <div className="c-line c-success">&lt; Result: 120</div>
            </div>
            <p className="preview-caption">
              Track console prints alongside the exact timeline steps that output them.
            </p>
          </div>
        </div>
      );

    case 'complexity hints':
      return (
        <div className="structure-preview-content complexity-preview animate-fade-in">
          <div className="preview-header-bar">
            <span>Estimated runtime complexity</span>
          </div>
          <div className="complexity-preview-container">
            <div className="complexity-badge">
              <span className="o-notation">O(log N)</span>
              <span className="complexity-label">Logarithmic Growth</span>
            </div>
            <table className="complexity-table">
              <thead>
                <tr>
                  <th>N (size)</th>
                  <th>Steps (approx)</th>
                  <th>Simulated Time</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>10</td>
                  <td>3</td>
                  <td>0.01 ms</td>
                </tr>
                <tr>
                  <td>100</td>
                  <td>6</td>
                  <td>0.02 ms</td>
                </tr>
                <tr>
                  <td>1,000</td>
                  <td>10</td>
                  <td>0.03 ms</td>
                </tr>
              </tbody>
            </table>
            <p className="preview-caption">
              Estimate loop cycles, scaling rates, and Big-O efficiency automatically from multiple runs.
            </p>
          </div>
        </div>
      );

    default:
      return (
        <div className="structure-preview-content empty-preview animate-fade-in">
          <p>Hover or click a state item on the left to preview how Code Visualizer renders it.</p>
        </div>
      );
  }
}
