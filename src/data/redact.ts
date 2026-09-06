/**
 * Lightweight scrub pass applied to raw GitHub issue title/body text before
 * any of it is committed to this repository. Addresses the open compliance
 * item in COMPLIANCE.md §5 item 1 ("decide a redaction/scrub policy before
 * pulling issue body/title text").
 *
 * This is a conservative, pattern-based scrub for accidental secrets/PII a
 * third-party reporter may have pasted (credentials, tokens, local file
 * paths containing a username) — not a general PII scrubber, and not a
 * substitute for not fabricating or altering substantive report content.
 * Only these specific patterns are touched; everything else is preserved
 * verbatim.
 */

const PATTERNS: readonly { readonly re: RegExp; readonly replacement: string }[] = [
  // Private key / certificate blocks
  { re: /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, replacement: "[redacted-key-block]" },
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)
  { re: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/g, replacement: "[redacted-token]" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: "[redacted-token]" },
  // AWS access key IDs
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[redacted-token]" },
  // JWT-shaped tokens
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: "[redacted-jwt]" },
  // Bearer tokens in headers/config pastes
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/gi, replacement: "Bearer [redacted-token]" },
  // Email addresses
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: "[redacted-email]" },
  // Windows user-profile paths (contain a local username)
  { re: /[A-Za-z]:\\Users\\[^\\/\s"'<>]+/g, replacement: "[redacted-path]" },
  // Unix home-directory paths (contain a local username)
  { re: /\/(?:home|Users)\/[^/\s"'<>]+/g, replacement: "[redacted-path]" },
];

export function redactText(text: string): string {
  let out = text;
  for (const { re, replacement } of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}
