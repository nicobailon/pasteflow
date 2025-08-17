/**
 * Tests for token recalculation indicator
 */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ClipboardPreviewModal from '../components/clipboard-preview-modal';
import type { PreviewState } from '../hooks/use-preview-generator';

describe('Token Recalculation Indicator', () => {
  const mockOnClose = jest.fn();
  const mockOnCopy = jest.fn();
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ClipboardPreviewModal', () => {
    it('should show recalculation indicator when status is loading', () => {
      const previewState: PreviewState = {
        id: 'test-id',
        status: 'loading',
        processed: 5,
        total: 10,
        percent: 50,
        tokenEstimate: 1000,
        contentForDisplay: 'Test content',
        fullContent: 'Test content',
      };

      render(
        <ClipboardPreviewModal
          isOpen={true}
          onClose={mockOnClose}
          onCopy={mockOnCopy}
          previewState={previewState}
          onCancel={mockOnCancel}
        />
      );

      // Check for recalculation indicator
      const indicator = screen.getByLabelText('Recalculating token count');
      expect(indicator).toBeInTheDocument();
      
      // Check for the animated dots with their specific classes
      const dots = indicator.querySelectorAll('.recalc-dot');
      expect(dots).toHaveLength(3);
      expect(dots[0]).toHaveClass('recalc-dot-1');
      expect(dots[1]).toHaveClass('recalc-dot-2');
      expect(dots[2]).toHaveClass('recalc-dot-3');
    });

    it('should show recalculation indicator when status is streaming', () => {
      const previewState: PreviewState = {
        id: 'test-id',
        status: 'streaming',
        processed: 7,
        total: 10,
        percent: 70,
        tokenEstimate: 1500,
        contentForDisplay: 'Streaming content',
        fullContent: 'Streaming content',
      };

      render(
        <ClipboardPreviewModal
          isOpen={true}
          onClose={mockOnClose}
          onCopy={mockOnCopy}
          previewState={previewState}
          onCancel={mockOnCancel}
        />
      );

      const indicator = screen.getByLabelText('Recalculating token count');
      expect(indicator).toBeInTheDocument();
      
      // Verify the indicator has proper accessibility label
      expect(indicator).toHaveAttribute('aria-label', 'Recalculating token count');
    });

    it('should NOT show recalculation indicator when status is complete', () => {
      const previewState: PreviewState = {
        id: 'test-id',
        status: 'complete',
        processed: 10,
        total: 10,
        percent: 100,
        tokenEstimate: 2000,
        contentForDisplay: 'Complete content',
        fullContent: 'Complete content',
      };

      render(
        <ClipboardPreviewModal
          isOpen={true}
          onClose={mockOnClose}
          onCopy={mockOnCopy}
          previewState={previewState}
          onCancel={mockOnCancel}
        />
      );

      const indicator = screen.queryByLabelText('Recalculating token count');
      expect(indicator).not.toBeInTheDocument();
      
      // Also check that no recalc dots exist
      const dots = document.querySelectorAll('.recalc-dot');
      expect(dots).toHaveLength(0);
    });

    it('should NOT show recalculation indicator when status is cancelled', () => {
      const previewState: PreviewState = {
        id: 'test-id',
        status: 'cancelled',
        processed: 5,
        total: 10,
        percent: 50,
        tokenEstimate: 1000,
        contentForDisplay: 'Cancelled content',
        fullContent: 'Cancelled content',
      };

      render(
        <ClipboardPreviewModal
          isOpen={true}
          onClose={mockOnClose}
          onCopy={mockOnCopy}
          previewState={previewState}
          onCancel={mockOnCancel}
        />
      );

      const indicator = screen.queryByLabelText('Recalculating token count');
      expect(indicator).not.toBeInTheDocument();
      
      // Verify the component doesn't have the indicator class
      const indicatorContainer = document.querySelector('.token-recalculating-indicator');
      expect(indicatorContainer).toBeNull();
    });

    it('should NOT show recalculation indicator when status is error', () => {
      const previewState: PreviewState = {
        id: 'test-id',
        status: 'error',
        processed: 3,
        total: 10,
        percent: 30,
        tokenEstimate: 500,
        contentForDisplay: '',
        fullContent: '',
        error: 'Test error',
      };

      render(
        <ClipboardPreviewModal
          isOpen={true}
          onClose={mockOnClose}
          onCopy={mockOnCopy}
          previewState={previewState}
          onCancel={mockOnCancel}
        />
      );

      const indicator = screen.queryByLabelText('Recalculating token count');
      expect(indicator).not.toBeInTheDocument();
      
      // Ensure no animation dots are present
      const dots = document.querySelectorAll('.recalc-dot');
      expect(dots).toHaveLength(0);
    });

    it('should NOT show recalculation indicator in fallback/static mode', () => {
      render(
        <ClipboardPreviewModal
          isOpen={true}
          onClose={mockOnClose}
          onCopy={mockOnCopy}
          content="Static content"
          tokenCount={1234}
        />
      );

      const indicator = screen.queryByLabelText('Recalculating token count');
      expect(indicator).not.toBeInTheDocument();
      
      // Verify the indicator container doesn't exist
      const indicatorContainer = document.querySelector('.token-recalculating-indicator');
      expect(indicatorContainer).toBeNull();
    });

    it('should have accessible screen reader text', () => {
      const previewState: PreviewState = {
        id: 'test-id',
        status: 'loading',
        processed: 5,
        total: 10,
        percent: 50,
        tokenEstimate: 1000,
        contentForDisplay: 'Test content',
        fullContent: 'Test content',
      };

      render(
        <ClipboardPreviewModal
          isOpen={true}
          onClose={mockOnClose}
          onCopy={mockOnCopy}
          previewState={previewState}
          onCancel={mockOnCancel}
        />
      );

      // Verify the indicator exists with proper aria-label for screen readers
      const indicator = screen.getByLabelText('Recalculating token count');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveClass('token-recalculating-indicator');
      
      // Verify the dots are properly marked as decorative (use specific selector)
      const dots = indicator.querySelectorAll('.recalc-dot[aria-hidden="true"]');
      expect(dots).toHaveLength(3);
    });
  });
});