/**
 * Semantic DOM Snapshot & UID Indexer (Mirroring Antigravity Accessibility Tree Snapshot).
 */

import type { CdpSession } from "./cdp-session";

export interface SnapshotResult {
  textSnapshot: string;
  elementsCount: number;
}

export class DomSnapshotEngine {
  /**
   * Injects an in-page crawler to index interactive and semantic elements,
   * assigning stable numeric UIDs and generating an accessibility tree snapshot.
   */
  static async captureSnapshot(session: CdpSession, verbose = false): Promise<SnapshotResult> {
    const crawlerScript = `
      (() => {
        let currentUid = 1;
        const uidMap = new Map();
        
        function getRole(el) {
          const tag = el.tagName.toLowerCase();
          const roleAttr = el.getAttribute('role');
          if (roleAttr) return roleAttr;
          if (tag === 'button') return 'button';
          if (tag === 'a') return 'link';
          if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (['checkbox', 'radio'].includes(type)) return type;
            return 'textbox';
          }
          if (tag === 'textarea') return 'textbox';
          if (tag === 'select') return 'combobox';
          if (/^h[1-6]$/.test(tag)) return 'heading';
          if (tag === 'img') return 'img';
          if (tag === 'nav') return 'navigation';
          if (tag === 'main') return 'main';
          if (tag === 'header') return 'banner';
          if (tag === 'footer') return 'contentinfo';
          return tag;
        }

        function isVisible(el) {
          if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        function isInteractive(el) {
          const tag = el.tagName.toLowerCase();
          const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'option', 'summary'];
          if (interactiveTags.includes(tag)) return true;
          if (el.getAttribute('role') || el.getAttribute('tabindex') || el.onclick) return true;
          const style = window.getComputedStyle(el);
          return style.cursor === 'pointer';
        }

        function getName(el) {
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel.trim();
          const placeholder = el.getAttribute('placeholder');
          if (placeholder) return placeholder.trim();
          const title = el.getAttribute('title');
          if (title) return title.trim();
          const alt = el.getAttribute('alt');
          if (alt) return alt.trim();
          
          let text = '';
          for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
              text += ' ' + child.textContent.trim();
            }
          }
          return text.trim();
        }

        const lines = [];
        const title = document.title || 'Untitled';
        lines.push(\`- RootWebArea "\${title}" [url="\${window.location.href}"]\`);

        function walk(el, depth = 1) {
          if (!isVisible(el)) return;

          const tag = el.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) return;

          const role = getRole(el);
          const name = getName(el);
          const interactive = isInteractive(el);
          const hasSignificantText = name.length > 0;

          let uid = null;
          if (interactive || hasSignificantText || ['heading', 'main', 'navigation'].includes(role)) {
            uid = String(currentUid++);
            el.setAttribute('data-groupy-mcp-uid', uid);
          }

          const indent = '  '.repeat(depth);
          const details = [];
          if (uid) details.push(\`uid="\${uid}"\`);
          if (role === 'heading') {
            const level = tag.match(/h([1-6])/)?.[1] || '2';
            details.push(\`level=\${level}\`);
          }
          if (tag === 'input' || tag === 'textarea') {
            const val = el.value !== undefined ? el.value : '';
            if (val) details.push(\`value="\${val}"\`);
          }
          if (el === document.activeElement) {
            details.push('focused');
          }
          if (el.disabled) {
            details.push('disabled');
          }

          const detailsStr = details.length > 0 ? \` [\${details.join(', ')}]\` : '';
          const nameStr = name ? \` "\${name}"\` : '';

          if (uid || ${verbose ? 'true' : 'false'}) {
            lines.push(\`\${indent}- \${role}\${nameStr}\${detailsStr}\`);
          }

          for (const child of el.children) {
            walk(child, depth + 1);
          }
        }

        if (document.body) {
          walk(document.body, 1);
        }

        return {
          text: lines.join('\\n'),
          count: currentUid - 1
        };
      })()
    `;

    const res = await session.send("Runtime.evaluate", {
      expression: crawlerScript,
      returnByValue: true,
      awaitPromise: true,
    });

    if (res.exceptionDetails) {
      throw new Error(`Failed to capture snapshot: ${res.exceptionDetails.text}`);
    }

    const val = res.result?.value || { text: "Empty Page", count: 0 };
    return {
      textSnapshot: val.text,
      elementsCount: val.count,
    };
  }

  /**
   * Targets an element by UID, evaluates its bounding box, scrolls into view,
   * and returns viewport center coordinates for mouse actions.
   */
  static async getElementCenter(session: CdpSession, uid: string): Promise<{ x: number; y: number }> {
    const script = `
      (() => {
        const el = document.querySelector(\`[data-groupy-mcp-uid="\${${JSON.stringify(uid)}}"]\`);
        if (!el) return null;
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          width: rect.width,
          height: rect.height
        };
      })()
    `;

    const res = await session.send("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
    });

    if (!res.result?.value) {
      throw new Error(`Element with UID '${uid}' not found in current page snapshot.`);
    }

    return res.result.value;
  }
}
