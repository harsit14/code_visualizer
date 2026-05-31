import { GitBranch, Orbit, Route, SquareStack } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type {
  PythonObjectSnapshot,
  PythonStaticAnalysis,
  PythonStaticNode,
  PythonTraceEvent,
  PythonVariableSnapshot,
} from '../../languages/python/runtimeTypes';

type VisualizationStageProps = {
  currentEvent: PythonTraceEvent | null;
  currentStep: number;
  exampleTitle: string;
  onObjectSelect: (objectId: string) => void;
  selectedObjectId?: string;
  staticAnalysis: PythonStaticAnalysis;
  totalSteps: number;
};

const stageNotes = [
  'entry',
  'assign',
  'reference',
  'iterate',
  'update',
  'branch',
  'output',
  'finish',
];

function getLocalPreview(event: PythonTraceEvent | null, name: string, fallback: string) {
  return event?.locals[name] ?? fallback;
}

function truncatePreview(value: string, maxLength = 18) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function formatObjectEntry(object: PythonObjectSnapshot, entryIndex: number) {
  const entry = object.entries?.[entryIndex];

  if (!entry) {
    return '';
  }

  const key = entry.keyPreview ?? entry.key;
  const value = truncatePreview(entry.valuePreview, 13);
  return `${key} -> ${value}`;
}

function getObjectMeta(object: PythonObjectSnapshot) {
  const count = object.entryCount ?? object.size;

  if (typeof count !== 'number') {
    return object.kind;
  }

  return `${count} item${count === 1 ? '' : 's'}${object.truncated ? '+' : ''}`;
}

function getVariableClassName(variable: PythonVariableSnapshot) {
  if (variable.isNew) {
    return 'variable-pill is-new';
  }

  if (variable.isChanged || variable.isReferenceChanged) {
    return 'variable-pill is-hot';
  }

  return 'variable-pill';
}

function getObjectClassName(
  object: PythonObjectSnapshot,
  variables: PythonVariableSnapshot[],
  selectedObjectId?: string,
) {
  const isLinked = variables.some((variable) => variable.objectId === object.id);
  return [
    'object-box',
    isLinked ? 'is-linked' : '',
    object.mutated ? 'is-mutated' : '',
    object.id === selectedObjectId ? 'is-selected' : '',
    'is-selectable',
  ]
    .filter(Boolean)
    .join(' ');
}

function getVariableGroupClassName(
  variable: PythonVariableSnapshot,
  selectableObjectIds: Set<string>,
  selectedObjectId?: string,
) {
  return [
    getVariableClassName(variable),
    selectableObjectIds.has(variable.objectId) ? 'is-selectable' : '',
    variable.objectId === selectedObjectId ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function getStaticNodeClassName(node: PythonStaticNode, currentStaticNodeId?: string) {
  return [
    'static-node',
    `static-node-${node.kind}`,
    node.id === currentStaticNodeId ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function VisualizationStage({
  currentEvent,
  currentStep,
  exampleTitle,
  onObjectSelect,
  selectedObjectId,
  staticAnalysis,
  totalSteps,
}: VisualizationStageProps) {
  const progress = currentStep / Math.max(totalSteps - 1, 1);
  const variables = currentEvent?.scope.variables ?? [];
  const referenceObjects =
    currentEvent?.objects.filter((object) => object.kind !== 'primitive') ?? [];
  const selectableObjectIds = new Set(referenceObjects.map((object) => object.id));
  const visibleVariables = variables.slice(0, 4);
  const visibleObjects = selectedObjectId
    ? [
        ...referenceObjects.filter((object) => object.id === selectedObjectId),
        ...referenceObjects.filter((object) => object.id !== selectedObjectId),
      ].slice(0, 3)
    : referenceObjects.slice(0, 3);
  const referenceLinks = visibleVariables
    .map((variable, variableIndex) => {
      const objectIndex = visibleObjects.findIndex((object) => object.id === variable.objectId);

      if (objectIndex === -1) {
        return null;
      }

      return {
        id: `${variable.name}-${variable.objectId}`,
        isHot: variable.isChanged || variable.isReferenceChanged || variable.isNew,
        objectY: 168 + objectIndex * 114,
        variableY: 159 + variableIndex * 38,
      };
    })
    .filter((link): link is NonNullable<typeof link> => Boolean(link));
  const activeLoops = currentEvent?.loopStack ?? [];
  const currentLoop = activeLoops[activeLoops.length - 1];
  const targetVariable = currentLoop?.targetName
    ? variables.find((variable) => variable.name === currentLoop.targetName)
    : undefined;
  const rawChangedVariable = currentLoop?.changedVariables
    .map((name) => variables.find((variable) => variable.name === name))
    .find((variable) => variable && variable.name !== currentLoop.targetName);
  const changedVariable = currentLoop?.iteration ? rawChangedVariable : undefined;
  const accumulatorVariable =
    changedVariable ??
    variables.find((variable) => /^(total|sum|count|result|acc)$/i.test(variable.name)) ??
    variables[0];
  const loopVariable =
    targetVariable ??
    variables.find((variable) => /^(i|j|k|index|idx|key|value|item)$/i.test(variable.name));
  const totalPreview =
    accumulatorVariable?.valuePreview ?? getLocalPreview(currentEvent, 'total', '0');
  const iPreview =
    currentLoop?.targetValue ??
    loopVariable?.valuePreview ??
    getLocalPreview(currentEvent, 'i', 'pending');
  const isFinalTraceStep = currentEvent !== null && currentStep >= totalSteps - 1;
  const stdoutPreview = isFinalTraceStep ? currentEvent.stdout.trimEnd() : '';
  const hasLoopValue = Boolean(currentLoop);
  const hasStdout = stdoutPreview.length > 0;
  const callStack = currentEvent?.callStack ?? [];
  const visibleCallFrames = callStack.slice(-4);
  const functionTransition = currentEvent?.functionTransition;
  const callFrameBaseX = hasLoopValue ? 112 : 96;
  const callFrameBaseY = hasLoopValue ? 96 : 312;
  const loopSourceLabel = currentLoop ? truncatePreview(currentLoop.label, 12) : 'loop';
  const loopSourceValue = currentLoop
    ? currentLoop.iteration > 0
      ? `iter ${currentLoop.iteration}`
      : currentLoop.phase
    : 'pending';
  const loopUpdateLabel = changedVariable ? `${changedVariable.name} update` : 'body';
  const loopUpdateValue = changedVariable
    ? truncatePreview(changedVariable.valuePreview, 11)
    : (currentLoop?.phase ?? 'ready');
  const staticNodes = staticAnalysis.nodes.filter((node) => node.kind !== 'module').slice(0, 7);
  const currentStaticNode = currentEvent?.staticNodeId
    ? staticAnalysis.nodes.find((node) => node.id === currentEvent.staticNodeId)
    : undefined;
  const phase = currentEvent
    ? currentEvent.type === 'line'
      ? `line ${currentEvent.line}`
      : currentEvent.type
    : (stageNotes[currentStep] ?? 'ready');

  function handleObjectKeyDown(event: KeyboardEvent<SVGGElement>, objectId: string) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    onObjectSelect(objectId);
  }

  return (
    <section className="panel visualization-panel" aria-label="Visualization stage">
      <header className="panel-header visualization-header">
        <div>
          <span className="eyebrow">Hybrid view</span>
          <h2>
            <Route size={18} />
            {exampleTitle}
          </h2>
        </div>
        <div className="viz-badges" aria-label="Visualization layers">
          <span>
            <GitBranch size={14} />
            flow
          </span>
          <span>
            <SquareStack size={14} />
            scope
          </span>
          <span>
            <Orbit size={14} />
            refs
          </span>
        </div>
      </header>

      {staticNodes.length > 0 ? (
        <div className="static-skeleton" aria-label="Static program map">
          <div className="static-skeleton-head">
            <span>Program map</span>
            <strong>
              {staticAnalysis.summary.functions} fn / {staticAnalysis.summary.loops} loops /{' '}
              {staticAnalysis.summary.branches} branches
            </strong>
          </div>
          <div className="static-node-list">
            {staticNodes.map((node) => (
              <div
                className={`${getStaticNodeClassName(node, currentStaticNode?.id)} depth-${Math.min(
                  node.depth,
                  4,
                )}`}
                key={node.id}
              >
                <span className="static-node-line">L{node.startLine}</span>
                <span className="static-node-label">{node.label}</span>
                {node.detail ? <span className="static-node-detail">{node.detail}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="stage-canvas">
        <svg
          aria-label="Preview runtime map"
          className="runtime-map"
          role="img"
          viewBox="0 0 980 570"
        >
          <defs>
            <marker id="arrow" markerHeight="5" markerWidth="5" orient="auto" refX="4.5" refY="2.5">
              <path d="M0 0 L5 2.5 L0 5 Z" fill="currentColor" />
            </marker>
            <filter id="soft-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect className="map-backdrop" x="0" y="0" width="980" height="570" rx="26" />

          <g className="execution-beacon">
            <circle cx="128" cy="176" r="48" />
            <circle cx="128" cy="176" r="18" />
            <text x="82" y="256">
              execution
            </text>
          </g>

          <path
            className={currentStep >= 1 ? 'visual-path is-live' : 'visual-path'}
            d="M176 176 C268 112 336 112 430 158"
            markerEnd="url(#arrow)"
          />
          {hasLoopValue ? (
            <>
              <path
                className="visual-path loop-path is-live"
                d="M288 412 C338 412 352 386 404 386"
                markerEnd="url(#arrow)"
              />
              <path
                className="visual-path loop-path is-live"
                d="M560 414 C624 446 692 444 736 414"
                markerEnd="url(#arrow)"
              />
              <path
                className="visual-path loop-back-path is-live"
                d="M520 472 C420 526 272 518 236 452"
                markerEnd="url(#arrow)"
              />
            </>
          ) : null}
          <path
            className={currentStep >= 5 ? 'visual-path reference-path is-live' : 'visual-path'}
            d="M666 184 C728 156 762 154 818 194"
            markerEnd="url(#arrow)"
          />

          {referenceLinks.map((link) => (
            <path
              className={link.isHot ? 'reference-link is-hot' : 'reference-link'}
              d={`M658 ${link.variableY} C700 ${link.variableY} 718 ${link.objectY} 762 ${link.objectY}`}
              key={link.id}
              markerEnd="url(#arrow)"
            />
          ))}

          <g className={currentStep >= 1 ? 'scope-frame is-awake' : 'scope-frame'}>
            <rect x="430" y="78" width="272" height="224" rx="22" />
            <text className="scope-title" x="462" y="118">
              {currentEvent?.scope.name ?? 'scope'}
            </text>
            {visibleVariables.length > 0 ? (
              visibleVariables.map((variable, index) => {
                const isSelectable = selectableObjectIds.has(variable.objectId);

                return (
                  <g
                    className={getVariableGroupClassName(
                      variable,
                      selectableObjectIds,
                      selectedObjectId,
                    )}
                    key={variable.name}
                    onClick={isSelectable ? () => onObjectSelect(variable.objectId) : undefined}
                    onKeyDown={
                      isSelectable
                        ? (event) => handleObjectKeyDown(event, variable.objectId)
                        : undefined
                    }
                    role={isSelectable ? 'button' : undefined}
                    tabIndex={isSelectable ? 0 : undefined}
                  >
                    <rect x="462" y={144 + index * 38} width="196" height="30" rx="10" />
                    <text x="482" y={164 + index * 38}>
                      {`${variable.name} -> ${truncatePreview(variable.valuePreview, 14)}`}
                    </text>
                  </g>
                );
              })
            ) : (
              <text className="scope-empty" x="462" y="164">
                run code to capture variables
              </text>
            )}
          </g>

          {visibleObjects.length > 0 ? (
            visibleObjects.map((object, index) => {
              const objectY = 112 + index * 114;
              const visibleEntryCount = Math.min(object.entries?.length ?? 0, 2);

              return (
                <g
                  className={getObjectClassName(object, visibleVariables, selectedObjectId)}
                  key={object.id}
                  onClick={() => onObjectSelect(object.id)}
                  onKeyDown={(event) => handleObjectKeyDown(event, object.id)}
                  role="button"
                  tabIndex={0}
                >
                  <rect x="762" y={objectY} width="176" height="112" rx="18" />
                  <text x="790" y={objectY + 30}>
                    {truncatePreview(object.typeName, 13)}
                  </text>
                  <text className="object-meta" x="790" y={objectY + 51}>
                    {getObjectMeta(object)}
                  </text>
                  <text className="object-value" x="790" y={objectY + 73}>
                    {truncatePreview(object.preview, 17)}
                  </text>
                  {Array.from({ length: visibleEntryCount }).map((_, entryIndex) => (
                    <text
                      className="object-entry"
                      key={entryIndex}
                      x="790"
                      y={objectY + 92 + entryIndex * 16}
                    >
                      {formatObjectEntry(object, entryIndex)}
                    </text>
                  ))}
                </g>
              );
            })
          ) : (
            <g className="object-box">
              <rect x="762" y="146" width="176" height="82" rx="18" />
              <text x="790" y="188">
                {currentEvent ? 'values only' : 'waiting for objects'}
              </text>
            </g>
          )}

          {hasLoopValue ? (
            <>
              <g className="loop-lane is-active">
                <rect x="144" y="354" width="144" height="76" rx="16" />
                <text className="loop-lane-label" x="170" y="383">
                  {loopSourceLabel}
                </text>
                <text className="loop-lane-value" x="170" y="414">
                  {loopSourceValue}
                </text>
              </g>

              <g className="loop-lane is-current">
                <rect x="404" y="348" width="156" height="90" rx="18" />
                <text className="loop-lane-label" x="432" y="381">
                  {currentLoop?.targetName ?? loopVariable?.name ?? 'index'}
                </text>
                <text className="loop-lane-value" x="432" y="416">
                  {iPreview}
                </text>
              </g>

              <g className="loop-lane is-update">
                <rect x="736" y="354" width="146" height="76" rx="16" />
                <text className="loop-lane-label" x="764" y="383">
                  {loopUpdateLabel}
                </text>
                <text className="loop-lane-value" x="764" y="414">
                  {loopUpdateValue || totalPreview}
                </text>
              </g>
            </>
          ) : null}

          {visibleCallFrames.length > 0 ? (
            <g className="function-theater">
              <text className="function-theater-title" x={callFrameBaseX} y={callFrameBaseY - 16}>
                call stack
              </text>
              {visibleCallFrames.map((frame, index) => (
                <g
                  className={[
                    'call-frame',
                    frame.status === 'entering' ? 'is-entering' : '',
                    frame.status === 'returning' ? 'is-returning' : '',
                    frame.status === 'exception' ? 'is-exception' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={frame.frameId}
                >
                  <rect
                    x={callFrameBaseX + index * 28}
                    y={callFrameBaseY + index * 48}
                    width="224"
                    height="70"
                    rx="16"
                  />
                  <text
                    className="call-frame-name"
                    x={callFrameBaseX + 24 + index * 28}
                    y={callFrameBaseY + 30 + index * 48}
                  >
                    {truncatePreview(frame.displayName, 20)}
                  </text>
                  <text
                    className="call-frame-meta"
                    x={callFrameBaseX + 24 + index * 28}
                    y={callFrameBaseY + 54 + index * 48}
                  >
                    {frame.returnValue
                      ? `return ${truncatePreview(frame.returnValue, 13)}`
                      : `${frame.variables.length} locals`}
                  </text>
                </g>
              ))}
              {functionTransition ? (
                <g className={`function-transition is-${functionTransition.type}`}>
                  <path
                    d={`M${callFrameBaseX + 240} ${callFrameBaseY + 36} C382 ${
                      callFrameBaseY + 18
                    } 404 126 440 142`}
                    markerEnd="url(#arrow)"
                  />
                  <text x={callFrameBaseX + 250} y={callFrameBaseY + 18}>
                    {functionTransition.type === 'return'
                      ? `return ${truncatePreview(functionTransition.valuePreview ?? '', 10)}`
                      : functionTransition.type}
                  </text>
                </g>
              ) : null}
            </g>
          ) : null}

          {hasStdout ? (
            <g className="output-node is-awake">
              <rect x="746" y="462" width="176" height="64" rx="18" />
              <text x="774" y="496">
                stdout
              </text>
              <text className="object-value" x="850" y="496">
                {stdoutPreview}
              </text>
            </g>
          ) : null}
        </svg>

        <div className="stage-readout">
          <span>{phase}</span>
          <strong>{Math.round(progress * 100)}%</strong>
        </div>
        {currentEvent ? (
          <div className="trace-readout">
            <span>step {currentEvent.step + 1}</span>
            <strong>{currentEvent.functionName}</strong>
          </div>
        ) : null}
      </div>
    </section>
  );
}
