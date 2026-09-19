import Phaser from 'phaser';
import './editor/editor.css';
import { TerrainDemoScene } from './scenes/TerrainDemoScene.js';

const gameContainer = document.getElementById('game-container');

new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameContainer,
  width: gameContainer.clientWidth,
  height: gameContainer.clientHeight,
  backgroundColor: '#1a1a1a',
  scene: [TerrainDemoScene],
  render: {
    pixelArt: false,
    antialias: true,
  },
});
