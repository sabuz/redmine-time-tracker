import { useEffect, useRef, useState } from "preact/hooks";
import { api, errMsg, type ProfileSite } from "../api";

// The GitHub mark (the shape of Octicons' "mark-github") and the WordPress logo (as drawn by Simple Icons, CC0).
// Both are trademarks of their owners, used only to link to the author's profiles (see THIRD-PARTY-NOTICES.md).
const GITHUB_MARK =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";
const WORDPRESS_MARK =
  "M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.405-.026-.78-.07-1.11m-7.981.105c.647-.03 1.232-.105 1.232-.105.582-.075.514-.93-.067-.899 0 0-1.755.135-2.88.135-1.064 0-2.85-.15-2.85-.15-.585-.03-.661.855-.075.885 0 0 .54.061 1.125.09l1.68 4.605-2.37 7.08L5.354 6.9c.649-.03 1.234-.1 1.234-.1.585-.075.516-.93-.065-.896 0 0-1.746.138-2.874.138-.2 0-.438-.008-.69-.015C4.911 3.15 8.235 1.215 12 1.215c2.809 0 5.365 1.072 7.286 2.833-.046-.003-.091-.009-.141-.009-1.06 0-1.812.923-1.812 1.914 0 .89.513 1.643 1.06 2.531.411.72.89 1.643.89 2.977 0 .915-.354 1.994-.821 3.479l-1.075 3.585-3.9-11.61.001.014zM12 22.784c-1.059 0-2.081-.153-3.048-.437l3.237-9.406 3.315 9.087c.024.053.05.101.078.149-1.12.393-2.325.609-3.582.609M1.211 12c0-1.564.336-3.05.935-4.39L7.29 21.709C3.694 19.96 1.212 16.271 1.211 12M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0";

const AUTHOR = "Nazmul Sabuz";

/** The app's own About popup (Help → About): what it is, who made it, and where to find them. */
export function About({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current?.focus();
    api.version().then(setVersion).catch(() => {});
  }, []);

  // The address itself is chosen in Rust; the view can only ask for one of these two profiles.
  const open = (site: ProfileSite) => api.openProfile(site).catch((e) => setError(errMsg(e)));

  return (
    <div class="scrim" onClick={onClose}>
      <div
        ref={dialog}
        class="dialog about"
        role="dialog"
        aria-modal="true"
        aria-label="About Redmine Time Tracker"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div class="developed muted">Developed by</div>
        <div class="author">{AUTHOR}</div>
        <div class="social">
          <button class="icon-link" aria-label={`${AUTHOR} on GitHub`} title="GitHub" onClick={() => open("github")}>
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d={GITHUB_MARK} />
            </svg>
          </button>
          <button class="icon-link" aria-label={`${AUTHOR} on WordPress.org`} title="WordPress.org" onClick={() => open("wordpress")}>
            <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
              <path d={WORDPRESS_MARK} />
            </svg>
          </button>
        </div>

        <div class="about-version muted small-text">{version && `Version ${version}`}</div>
        {error && (
          <div class="error" role="alert">
            {error}
          </div>
        )}
        <button class="icon dismiss" aria-label="Close" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}
