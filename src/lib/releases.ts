type ReleaseEntryLike = {
  data: {
    tagName: string;
    publishedAt: string | null;
    assets: readonly unknown[];
  };
};

function releaseTime(release: ReleaseEntryLike): number {
  return release.data.publishedAt ? Date.parse(release.data.publishedAt) : 0;
}

export function sortReleasesNewestFirst<T extends ReleaseEntryLike>(releases: readonly T[]): T[] {
  return releases.toSorted((left, right) => {
    const timeDifference = releaseTime(right) - releaseTime(left);
    if (timeDifference !== 0) return timeDifference;

    return right.data.tagName.localeCompare(left.data.tagName, undefined, { numeric: true });
  });
}

export function newestReleaseWithAssets<T extends ReleaseEntryLike>(releases: readonly T[]): T | undefined {
  const sortedReleases = sortReleasesNewestFirst(releases);
  return sortedReleases.find((release) => release.data.assets.length > 0) ?? sortedReleases[0];
}
