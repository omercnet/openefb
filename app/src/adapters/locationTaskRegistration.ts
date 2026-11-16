// Importing this defines the background location task at bundle load, so the OS can relaunch the app into it
// (handoff: "the app entry must import adapters/location"). The web build has no background tasks.
import './location';
