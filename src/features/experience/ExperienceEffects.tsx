import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ONLINE_EXP_AWARDED_EVENT } from './onlineExperienceService';

type OnlineAwardDetail = {
  amount?: number;
};

type OnlinePulse = {
  token: number;
  amount: number;
};

export function ExperienceEffects({ level, enabled }: { level: number; enabled: boolean }) {
  const previousLevel = useRef<number | null>(null);
  const [levelUpToken, setLevelUpToken] = useState<number | null>(null);
  const [onlinePulse, setOnlinePulse] = useState<OnlinePulse | null>(null);
  const [levelAnchor, setLevelAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLevelAnchor(null);
      return;
    }

    const anchor = document.querySelector<HTMLElement>('.level-strip__level');
    setLevelAnchor(anchor);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const handleOnlineAward = (event: Event) => {
      const detail = (event as CustomEvent<OnlineAwardDetail>).detail;
      const amount = Number(detail?.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) return;
      setOnlinePulse({ token: Date.now(), amount });
    };

    window.addEventListener(ONLINE_EXP_AWARDED_EVENT, handleOnlineAward as EventListener);
    return () => window.removeEventListener(ONLINE_EXP_AWARDED_EVENT, handleOnlineAward as EventListener);
  }, [enabled]);

  useEffect(() => {
    if (!onlinePulse) return;
    const timeout = window.setTimeout(() => setOnlinePulse(null), 1900);
    return () => window.clearTimeout(timeout);
  }, [onlinePulse]);

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
      {enabled && onlinePulse && levelAnchor
        ? createPortal(
            <span className="online-exp-float" key={onlinePulse.token} aria-hidden="true">
              +{onlinePulse.amount} EXP
            </span>,
            levelAnchor,
          )
        : null}
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
