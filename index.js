/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import VideoPlayerRoot from './src/VideoPlayerRoot';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerComponent('VideoPlayerActivity', () => VideoPlayerRoot);

