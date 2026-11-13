import { createContext, useContext } from 'react';
import type { RecordingViewStore } from '../state/recordingStore';

/**
 * The recording view model the strip's notices read (FlightLogNotices stacks RecordingNotices last, as FlightLogRows.swift
 * does when it has a RecordingViewModel). null: no recorder, nothing to stack. I1's shell provides the real store; the
 * recording captures provide a lab on fakes.
 */
export const RecordingStoreContext = createContext<RecordingViewStore | null>(null);

export const useRecordingStore = (): RecordingViewStore | null => useContext(RecordingStoreContext);
