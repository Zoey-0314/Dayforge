import { useEffect, useRef, useState } from 'react';

export function ExperienceEffects({ level, enabled }: { level: number; enabled: boolean }) {
  const previousLevel = useRef<number | null>(null);
  const [levelUpToken, setLevelUpToken] = useState<number | null>(null);

  useEffect(() => {
    // Treat the first fully-loaded level as the baseline so reopening an
    // existing Lv.2+ profile does not replay a fake level-up celebration.
    if (!enabled) {
      previousLevel.current = null;
      return;
    }

    if (previousLevel.current === null) {
      previousLevel.current = level;
      return;
    }

    if (level > previousLevel.current) {
      setLevelUpToken(Date.now());
    }

    previousLevel.current = level;
  }, [enabled, level]);

  useEffect(() => {
    if (levelUpToken === null) return;
    const timeout = window.setTimeout(() => setLevelUpToken(null), 1650);
    return () => window.clearTimeout(timeout);
  }, [levelUpToken]);

  return (
    <>
      {enabled ? <div className="online-exp-float" aria-hidden="true">+0.5 EXP</div> : null}
      {levelUpToken !== null ? (
        <div className="level-up-celebration" key={levelUpToken} aria-hidden="true">
          <div className="level-up-glow" />
          <div className="level-up-copy">
            <span>LEVEL UP</span>
            <strong>Lv.{level}</strong>
          </div>
          <div className="level-up-particles">
            {Array.from({ length: 16 }, (_, index) => <i key={index} />)}
          </div>
        </div>
      ) : null}
    </>
  );
}
