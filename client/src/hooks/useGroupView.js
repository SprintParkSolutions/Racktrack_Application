import { useSearchParams } from 'react-router-dom';
import { useRackGroup } from '../components/useRackGroup';

// A rack's GROUP view (side-by-side / rack toggle) is shown ONLY when the URL
// explicitly opts in via ?group=<groupId> — a signal set by the two-rack
// workflow and carried through its sub-pages.
//
// This is deliberate: rack ids are a fingerprint of the photo, so re-uploading
// a photo that was once part of a two-rack scan would otherwise re-open that
// old group. The rule the product wants is simpler — "you only get the report
// of what you uploaded": a single-rack scan always shows a single report, a
// two-rack scan shows the group. Membership alone never triggers the group view.
export function useGroupView(rackId) {
  const [searchParams] = useSearchParams();
  const groupParam = searchParams.get('group');
  // Pass the expected group so a stale cached `null` is bypassed and refetched.
  const { data, loading, error } = useRackGroup(rackId, groupParam);
  const members = data?.members || [];
  const isGroup = !!(
    data?.group?.id &&
    groupParam &&
    data.group.id === groupParam &&
    members.length >= 2
  );
  return { data, loading, error, isGroup, groupParam, members };
}
