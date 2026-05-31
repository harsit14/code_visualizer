import { Boxes, CircleDot, Link2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { PythonTraceEvent } from '../../languages/python/runtimeTypes';

type ScopeInspectorProps = {
  currentEvent: PythonTraceEvent | null;
  currentStep: number;
  onObjectSelect: (objectId: string) => void;
  selectedObjectId?: string;
  totalSteps: number;
};

type VariableRow = {
  objectId: string;
  name: string;
  typeName: string;
  value: string;
  marker: 'new' | 'hot' | 'calm';
  selectable: boolean;
};

function truncateValue(value: string, maxLength = 38) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

export function ScopeInspector({
  currentEvent,
  currentStep,
  onObjectSelect,
  selectedObjectId,
  totalSteps,
}: ScopeInspectorProps) {
  const referenceObjects =
    currentEvent?.objects.filter((object) => object.kind !== 'primitive') ?? [];
  const referenceObjectIds = new Set(referenceObjects.map((object) => object.id));
  const visibleObjects = selectedObjectId
    ? [
        ...referenceObjects.filter((object) => object.id === selectedObjectId),
        ...referenceObjects.filter((object) => object.id !== selectedObjectId),
      ].slice(0, 3)
    : referenceObjects.slice(0, 3);
  const variables: VariableRow[] =
    currentEvent?.scope.variables.map((variable) => ({
      objectId: variable.objectId,
      name: variable.name,
      selectable: referenceObjectIds.has(variable.objectId),
      typeName: variable.typeName,
      value: variable.valuePreview,
      marker:
        variable.isNew || variable.isReferenceChanged ? 'new' : variable.isChanged ? 'hot' : 'calm',
    })) ?? [];
  const objectCount = referenceObjects.length;
  const mutatedCount =
    currentEvent?.changes.mutatedObjects.filter((objectId) => referenceObjectIds.has(objectId))
      .length ?? 0;

  function getObjectSuffix(objectId: string) {
    return objectId.replace('obj-', '#');
  }

  function getObjectMeta(object: (typeof referenceObjects)[number]) {
    const count = object.entryCount ?? object.size;

    if (typeof count !== 'number') {
      return object.kind;
    }

    return `${count} item${count === 1 ? '' : 's'}${object.truncated ? '+' : ''}`;
  }

  function handleObjectKeyDown(event: KeyboardEvent<HTMLElement>, objectId: string) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    onObjectSelect(objectId);
  }

  return (
    <section className="panel inspector-panel" aria-label="Scope inspector">
      <header className="panel-header">
        <div>
          <span className="eyebrow">Inspector</span>
          <h2>
            <Boxes size={18} />
            Scope
          </h2>
        </div>
        <span className="panel-chip">
          <CircleDot size={14} />
          step {currentStep + 1}/{totalSteps}
        </span>
      </header>

      <div className="scope-card">
        <div className="scope-card-head">
          <span>{currentEvent?.scope.name ?? 'global'}</span>
          <span className="scope-object-count">
            <Link2 size={15} />
            {objectCount} objects
          </span>
        </div>

        {variables.length > 0 ? (
          <div className="variable-list">
            {mutatedCount > 0 ? (
              <div className="inspector-note">{mutatedCount} object mutation detected</div>
            ) : null}
            {variables.map((variable) => (
              <div
                className={[
                  'variable-row',
                  variable.marker,
                  variable.selectable ? 'is-selectable' : '',
                  variable.objectId === selectedObjectId ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={variable.name}
                onClick={variable.selectable ? () => onObjectSelect(variable.objectId) : undefined}
                onKeyDown={
                  variable.selectable
                    ? (event) => handleObjectKeyDown(event, variable.objectId)
                    : undefined
                }
                role={variable.selectable ? 'button' : undefined}
                tabIndex={variable.selectable ? 0 : undefined}
              >
                <span className="variable-name">
                  {variable.name}
                  <small>{variable.typeName}</small>
                </span>
                <span className="variable-value" title={getObjectSuffix(variable.objectId)}>
                  {variable.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-inspector">
            Run Python to capture locals for each executed line.
          </div>
        )}

        {visibleObjects.length > 0 ? (
          <div className="object-detail-list" aria-label="Object details">
            {visibleObjects.map((object) => (
              <div
                className={[
                  'object-detail',
                  'is-selectable',
                  object.mutated ? 'is-mutated' : '',
                  object.id === selectedObjectId ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={object.id}
                onClick={() => onObjectSelect(object.id)}
                onKeyDown={(event) => handleObjectKeyDown(event, object.id)}
                role="button"
                tabIndex={0}
              >
                <div className="object-detail-head">
                  <span>{object.typeName}</span>
                  <small title={getObjectSuffix(object.id)}>{getObjectMeta(object)}</small>
                </div>
                <div className="object-entry-list">
                  {(object.entries ?? []).slice(0, 5).map((entry) => (
                    <div className="object-entry-row" key={`${object.id}-${entry.key}`}>
                      <span>{entry.keyPreview ?? entry.key}</span>
                      <strong>{truncateValue(entry.valuePreview)}</strong>
                    </div>
                  ))}
                  {object.truncated ? (
                    <div className="object-entry-row muted">
                      <span>more</span>
                      <strong>
                        {Math.max((object.entryCount ?? 0) - (object.entries?.length ?? 0), 0)}{' '}
                        hidden
                      </strong>
                    </div>
                  ) : null}
                  {(object.entries?.length ?? 0) === 0 ? (
                    <div className="object-entry-row muted">
                      <span>preview</span>
                      <strong>{truncateValue(object.preview)}</strong>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
