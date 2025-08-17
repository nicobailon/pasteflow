import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import CopyButton from '../components/copy-button';

// Mock the clipboard API similar to existing tests
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

describe('CopyButton backoff behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('backs off to avoid copying the loading placeholder when the source resolves on a subsequent attempt', async () => {
    let calls = 0;
    const textSource = () => {
      calls += 1;
      return calls === 1 ? '[Content is loading...]' : 'Real content';
    };

    render(
      <CopyButton text={textSource}>
        Copy
      </CopyButton>
    );

    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Real content');
    });
  });

  it('eventually copies whatever is available when placeholder persists across all attempts', async () => {
    const alwaysPlaceholder = () => '[Content is loading...]';

    render(
      <CopyButton text={alwaysPlaceholder}>
        Copy
      </CopyButton>
    );

    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('[Content is loading...]');
    });
  });
});