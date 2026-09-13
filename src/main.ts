import './style.css';
import { queryElements } from './ui/dom';
import { createController } from './ui/controller';

createController(queryElements());
