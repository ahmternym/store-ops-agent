import { readFile } from 'node:fs/promises';

export type Review = {
  id: string;
  store: 'appstore';
  country: string;
  rating: number;
  title: string;
  text: string;
  version: string;
  author: string;
  date: string;
};

type RssEntry = {
  id: { label: string };
  title?: { label: string };
  content?: { label: string };
  updated?: { label: string };
  author?: { name?: { label: string } };
  'im:rating'?: { label: string };
  'im:version'?: { label: string };
};

/** Turns Apple's public customer-reviews RSS (JSON flavour) into plain review objects. */
export function parseAppStoreFeed(json: unknown, country: string): Review[] {
  const feed = (json as { feed?: { entry?: RssEntry | RssEntry[] } })?.feed;
  if (!feed?.entry) return [];
  // Apple returns a single object instead of an array when there is exactly one review
  const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
  return entries
    .filter((e) => e['im:rating']) // the first entry of older feeds is app metadata, not a review
    .map((e) => ({
      id: e.id.label,
      store: 'appstore' as const,
      country,
      rating: Number(e['im:rating']!.label),
      title: e.title?.label ?? '',
      text: e.content?.label ?? '',
      version: (e['im:version']?.label ?? '').replace(/^Version\s*/i, '').replace(/,.*$/, '').trim(),
      author: e.author?.name?.label ?? 'anonymous',
      date: e.updated?.label ? new Date(e.updated.label).toISOString() : ''
    }));
}

export function feedUrl(appId: string, country: string, page = 1) {
  return `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`;
}

export type ReviewSource = (country: string) => Promise<Review[]>;

/** Live source: Apple's public feed, no API key needed. */
export function appStoreSource(appId: string, fetchImpl: typeof fetch = fetch): ReviewSource {
  return async (country) => {
    const res = await fetchImpl(feedUrl(appId, country));
    if (!res.ok) throw new Error(`App Store feed ${country}: HTTP ${res.status}`);
    return parseAppStoreFeed(await res.json(), country);
  };
}

/** Offline source for tests and demos. */
export function fixtureSource(file: string): ReviewSource {
  return async (country) => {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.feed) return parseAppStoreFeed(data, country);
    return (data.reviews as Review[]).filter((r) => country === 'all' || r.country === country);
  };
}
