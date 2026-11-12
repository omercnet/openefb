// The debrief model the app wires into DebriefEngine: Apple FoundationModels on iOS. The debrief is not offered anywhere
// else in v1 (owner decision Q8, hidden on Android; Gemini Nano through ML Kit is a post-parity ticket), so the other
// platforms get a model that is never available and reports `offered: false` for screens to hide the feature.
import { Platform } from 'react-native';

import { unavailableDebriefModel, type DebriefModel } from '../domain/ports/debriefModel';
import { createFoundationModelsDebriefModel } from './foundationModels';

export function createDebriefModel(): DebriefModel {
  return Platform.OS === 'ios'
    ? createFoundationModelsDebriefModel()
    : unavailableDebriefModel('notOfferedOnThisPlatform');
}
