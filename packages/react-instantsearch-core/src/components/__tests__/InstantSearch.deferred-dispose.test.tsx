/**
 * @jest-environment @instantsearch/testutils/jest-environment-jsdom.ts
 */

import { createAlgoliaSearchClient } from '@instantsearch/mocks';
import { wait } from '@instantsearch/testutils';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SearchBox } from 'react-instantsearch';

import { useInstantSearchContext } from '../../lib/useInstantSearchContext';
import { InstantSearch } from '../InstantSearch';

import type { InstantSearch as InstantSearchType } from 'instantsearch.js';

/**
 * Next.js App Router keeps the page fiber (refs included) while tearing down
 * effects, the same way React Activity does. `useSyncExternalStore` then
 * unsubscribes immediately, the deferred dispose timeout fires while the user
 * is on another route, and a later resubscribe must restart the instance.
 *
 * React 19.0 does not export Activity, so this mock lets the test unsubscribe
 * and resubscribe later without resetting `useInstantSearchApi` refs.
 */
let mockSubscribeToSearch: (() => () => void) | undefined;
let mockUnsubscribeFromSearch: (() => void) | undefined;

jest.mock('use-sync-external-store/shim', () => {
  const ReactActual = jest.requireActual('react');

  return {
    useSyncExternalStore(
      subscribe: () => () => void,
      getSnapshot: () => unknown
    ) {
      ReactActual.useLayoutEffect(() => {
        mockSubscribeToSearch = subscribe;
        mockUnsubscribeFromSearch = subscribe();

        return () => {
          mockUnsubscribeFromSearch?.();
        };
      }, [subscribe]);

      return getSnapshot();
    },
  };
});

function StartedProbe({
  onSearch,
}: {
  onSearch: (search: InstantSearchType) => void;
}) {
  const search = useInstantSearchContext();
  onSearch(search);
  return null;
}

describe('InstantSearch deferred dispose', () => {
  test('restarts a reused instance after the deferred dispose has already fired', async () => {
    const searchClient = createAlgoliaSearchClient({});
    let search: InstantSearchType | undefined;

    function App() {
      return (
        <InstantSearch indexName="indexName" searchClient={searchClient}>
          <StartedProbe
            onSearch={(instance) => {
              search = instance;
            }}
          />
          <SearchBox />
        </InstantSearch>
      );
    }

    const { rerender } = render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
    expect(search?.started).toEqual(true);

    act(() => {
      mockUnsubscribeFromSearch?.();
    });

    // The instance is disposed on the next timer tick, not in the same
    // subscribe/unsubscribe pair (that path is a re-render, not a navigation).
    await wait(100);

    expect(search?.started).toEqual(false);

    act(() => {
      mockUnsubscribeFromSearch = mockSubscribeToSearch?.();
    });

    rerender(<App />);

    await waitFor(() => {
      expect(search?.started).toEqual(true);
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });
    // Resubscribe must take the update branch (stale timer id) so this
    // flag is cleared; otherwise useWidget would skip removeWidgets.
    expect(
      (search as { _preventWidgetCleanup?: boolean })._preventWidgetCleanup
    ).toEqual(false);
  });
});
