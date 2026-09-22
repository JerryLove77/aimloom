import { useT, type MessageKey } from '../../i18n';
import type { Step } from '../state';
export const stepNames: MessageKey[] = ['installer.step.location', 'installer.step.content', 'installer.step.review', 'installer.step.result'];
export function StepRail({ step, onStep, disabled, canSelect, canReview }: {
  step: Step;
  onStep: (step: Step) => void;
  disabled: boolean;
  canSelect: boolean;
  canReview: boolean;
}) {
  const t = useT();
  return <div className="ki-steps">
    <div className="ki-step-target" aria-label={t('installer.step.aria', { step })}>
      <svg viewBox="0 0 88 88" aria-hidden="true">
        {[0, 1, 2, 3].map(n => <circle key={n} cx="44" cy="44" r="37" pathLength="100" fill="none" strokeWidth="3" strokeDasharray="21 79" transform={`rotate(${n * 90 - 87} 44 44)`} className={n + 1 <= step ? 'is-active' : ''} />)}
        <circle cx="44" cy="44" r="28" fill="none" className="ki-inner-ring" />
      </svg>
      <div>
        <strong>
          {step}
        </strong>
        <span>/ 4</span>
      </div>
    </div>
    <ol>
      {stepNames.map((label, i) => {
        const num = (i + 1) as Step;
        const unavailable = disabled || num > step || num === 4 || num === 2 && !canSelect || num === 3 && !canReview;
        return <li key={label}>
          <button type="button" aria-current={num === step ? 'step' : undefined} disabled={unavailable} onClick={() => onStep(num)}>
            <span>
              {num < step ? '✓' : `0${num}`}
            </span>
            {t(label)}
          </button>
        </li>;
      })}
    </ol>
  </div>;
}
