import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { inferPageFromUrl } from '../src/urls';

// Regression coverage for FOUND-02 / Bug R1.4:
// inferPageFromUrl must not throw when fed relative URLs, empty strings, or undefined.
describe('inferPageFromUrl (relative URL handling)', () => {
    let originalConsoleError: typeof console.error;

    beforeEach(() => {
        originalConsoleError = console.error;
        // Suppress expected console.error output in the empty-string / null-case branches.
        console.error = () => {};
    });

    afterEach(() => {
        console.error = originalConsoleError;
    });

    it('handles service-worker preview URLs like /preview/<branchId>/<frameId>/ without throwing', () => {
        expect(() => inferPageFromUrl('/preview/abc/def/')).not.toThrow();
        expect(inferPageFromUrl('/preview/abc/def/')).toEqual({
            name: 'def',
            path: '/preview/abc/def/',
        });
    });

    it('handles a simple relative path like /foo/bar', () => {
        expect(() => inferPageFromUrl('/foo/bar')).not.toThrow();
        expect(inferPageFromUrl('/foo/bar')).toEqual({
            name: 'bar',
            path: '/foo/bar',
        });
    });

    it('handles a relative root path "/"', () => {
        expect(() => inferPageFromUrl('/')).not.toThrow();
        expect(inferPageFromUrl('/')).toEqual({
            name: 'Home',
            path: '/',
        });
    });

    it('returns the null-case sentinel for an empty string without throwing', () => {
        expect(() => inferPageFromUrl('')).not.toThrow();
        expect(inferPageFromUrl('')).toEqual({
            name: 'Unknown Page',
            path: '/',
        });
    });

    it('returns the null-case sentinel for undefined without throwing', () => {
        expect(() => inferPageFromUrl(undefined)).not.toThrow();
        expect(inferPageFromUrl(undefined)).toEqual({
            name: 'Unknown Page',
            path: '/',
        });
    });

    it('returns the null-case sentinel for null without throwing', () => {
        expect(() => inferPageFromUrl(null)).not.toThrow();
        expect(inferPageFromUrl(null)).toEqual({
            name: 'Unknown Page',
            path: '/',
        });
    });

    it('still handles absolute URLs (regression)', () => {
        expect(inferPageFromUrl('http://example.com/foo/bar')).toEqual({
            name: 'bar',
            path: '/foo/bar',
        });
    });

    it('still returns Home for absolute URLs at the root (regression)', () => {
        expect(inferPageFromUrl('https://example.com/')).toEqual({
            name: 'Home',
            path: '/',
        });
    });

    it('still formats dashes/underscores for absolute URLs (regression)', () => {
        expect(inferPageFromUrl('https://example.com/contact-us')).toEqual({
            name: 'contact us',
            path: '/contact-us',
        });
    });
});
