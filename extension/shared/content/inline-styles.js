export default `
  .klarkey-inline-root {
    --klarkey-surface: rgba(17, 18, 20, 0.76);
    --klarkey-surface-strong: rgba(26, 28, 31, 0.9);
    --klarkey-border: rgba(255, 255, 255, 0.09);
    --klarkey-accent: #8ed0ff;
    --klarkey-text: rgba(255, 255, 255, 0.92);
    --klarkey-muted: rgba(255, 255, 255, 0.56);
    --klarkey-faint: rgba(255, 255, 255, 0.34);
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483646;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--klarkey-text);
    letter-spacing: 0.01em;
  }

  .klarkey-inline-menu {
    position: fixed;
    min-width: 296px;
    max-width: 380px;
    background: var(--klarkey-surface);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--klarkey-border);
    border-radius: 14px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.2),
      0 28px 60px rgba(0, 0, 0, 0.46);
    overflow: hidden;
    pointer-events: auto;
  }

  .klarkey-inline-trigger {
    position: fixed;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
    transition: transform 120ms ease, opacity 120ms ease;
    opacity: 0.92;
  }

  .klarkey-inline-trigger:hover {
    opacity: 1;
    transform: scale(1.04);
  }

  .klarkey-inline-trigger:focus-visible {
    outline: 2px solid var(--klarkey-accent);
    outline-offset: 2px;
  }

  .klarkey-inline-trigger img {
    width: 20px;
    height: 20px;
    display: block;
    filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.28));
  }

  .klarkey-inline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--klarkey-border);
  }

  .klarkey-inline-brand {
    font-size: 12px;
    font-weight: 600;
    color: var(--klarkey-text);
  }

  .klarkey-inline-subtle {
    font-size: 12px;
    color: var(--klarkey-muted);
  }

  .klarkey-inline-list {
    display: flex;
    flex-direction: column;
  }

  .klarkey-inline-loading {
    padding: 14px;
    color: var(--klarkey-muted);
    font-size: 13px;
  }

  .klarkey-inline-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 52px;
    padding: 12px 14px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
  }

  .klarkey-inline-item + .klarkey-inline-item {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .klarkey-inline-item.active,
  .klarkey-inline-action.active {
    background: rgba(255, 255, 255, 0.08);
  }

  .klarkey-inline-item:hover,
  .klarkey-inline-action:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .klarkey-inline-copy {
    min-width: 0;
  }

  .klarkey-inline-title {
    font-size: 14px;
    font-weight: 560;
    color: var(--klarkey-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .klarkey-inline-secondary {
    margin-top: 2px;
    color: var(--klarkey-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .klarkey-inline-empty,
  .klarkey-inline-footer {
    padding: 14px;
    color: var(--klarkey-muted);
    font-size: 13px;
  }

  .klarkey-inline-actions {
    border-top: 1px solid var(--klarkey-border);
  }

  .klarkey-inline-action {
    width: 100%;
    padding: 12px 14px;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.86);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    transition: background 100ms ease;
  }

  .klarkey-inline-action + .klarkey-inline-action {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .klarkey-save-banner {
    position: fixed;
    top: 16px;
    right: 16px;
    width: min(360px, calc(100vw - 32px));
    background: var(--klarkey-surface);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--klarkey-border);
    border-radius: 14px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.24),
      0 28px 60px rgba(0, 0, 0, 0.48);
    padding: 14px 16px;
    pointer-events: auto;
    transform: translateX(0);
    transition: transform 180ms ease, opacity 180ms ease;
    animation: klarkey-slide-in 200ms ease;
  }

  .klarkey-save-banner.hidden {
    opacity: 0;
    transform: translateX(20px);
  }

  .klarkey-save-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 6px;
    letter-spacing: -0.02em;
  }

  .klarkey-save-copy {
    margin: 0;
    color: var(--klarkey-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .klarkey-save-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }

  .klarkey-save-choice-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
  }

  .klarkey-save-choice {
    width: 100%;
    border: 1px solid var(--klarkey-border);
    border-radius: 12px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--klarkey-text);
    cursor: pointer;
    text-align: left;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .klarkey-save-choice:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .klarkey-save-choice-title {
    font-size: 13px;
    font-weight: 560;
  }

  .klarkey-save-choice-copy {
    margin-top: 2px;
    color: var(--klarkey-muted);
    font-size: 12px;
  }

  .klarkey-save-button {
    border: 1px solid var(--klarkey-border);
    border-radius: 999px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.88);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .klarkey-save-button:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .klarkey-save-button.primary {
    background: var(--klarkey-accent);
    border-color: rgba(142, 208, 255, 0.5);
    color: #0a0a0b;
  }

  .klarkey-save-button.primary:hover {
    background: #b5e4ff;
  }

  .klarkey-sso-highlight {
    position: fixed;
    border: 2px solid #E07878;
    padding: 6px;
    pointer-events: none;
    z-index: 2147483645;
    box-sizing: border-box;
    transition: top 60ms ease, left 60ms ease, width 60ms ease, height 60ms ease;
  }

  .klarkey-sso-badge {
    position: absolute;
    top: -10px;
    right: -10px;
    width: 20px;
    height: 20px;
    pointer-events: none;
  }

  .klarkey-sso-badge img {
    width: 20px;
    height: 20px;
    display: block;
    filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.28));
  }

  .klarkey-sso-label {
    position: absolute;
    left: 8px;
    top: -11px;
    max-width: min(220px, calc(100% - 40px));
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(26, 28, 31, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.82);
    font-size: 11px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.24);
  }

  .klarkey-sso-badge img {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 50%;
  }

  @keyframes klarkey-slide-in {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
`
