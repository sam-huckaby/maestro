import { ShortTermMemory } from '../../../src/memory/stores/ShortTermMemory.js';

describe('ShortTermMemory', () => {
  let memory: ShortTermMemory;

  beforeEach(() => {
    memory = new ShortTermMemory({
      maxSize: 100,
      defaultTtlMs: 60000,
    });
  });

  describe('set/get', () => {
    it('should store and retrieve values', () => {
      memory.set('agent1', 'key1', 'value1');
      expect(memory.get('agent1', 'key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(memory.get('agent1', 'nonexistent')).toBeUndefined();
    });

    it('should isolate values by agent', () => {
      memory.set('agent1', 'key', 'value1');
      memory.set('agent2', 'key', 'value2');

      expect(memory.get('agent1', 'key')).toBe('value1');
      expect(memory.get('agent2', 'key')).toBe('value2');
    });

    it('should store complex objects', () => {
      const obj = { nested: { data: [1, 2, 3] } };
      memory.set('agent1', 'complex', obj);
      expect(memory.get('agent1', 'complex')).toEqual(obj);
    });
  });

  describe('has', () => {
    it('should return true for existing keys', () => {
      memory.set('agent1', 'key1', 'value1');
      expect(memory.has('agent1', 'key1')).toBe(true);
    });

    it('should return false for non-existent keys', () => {
      expect(memory.has('agent1', 'nonexistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should remove entries', () => {
      memory.set('agent1', 'key1', 'value1');
      memory.delete('agent1', 'key1');
      expect(memory.has('agent1', 'key1')).toBe(false);
    });

    it('should return true when key exists', () => {
      memory.set('agent1', 'key1', 'value1');
      expect(memory.delete('agent1', 'key1')).toBe(true);
    });

    it('should return false when key does not exist', () => {
      expect(memory.delete('agent1', 'nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      memory.set('agent1', 'key1', 'value1');
      memory.set('agent2', 'key2', 'value2');
      memory.clear();

      expect(memory.getSize()).toBe(0);
    });

    it('should clear only entries for specific agent', () => {
      memory.set('agent1', 'key1', 'value1');
      memory.set('agent2', 'key2', 'value2');
      memory.clear('agent1');

      expect(memory.has('agent1', 'key1')).toBe(false);
      expect(memory.has('agent2', 'key2')).toBe(true);
    });
  });

  describe('getAll', () => {
    it('should return all entries for an agent', () => {
      memory.set('agent1', 'key1', 'value1');
      memory.set('agent1', 'key2', 'value2');
      memory.set('agent2', 'key3', 'value3');

      const entries = memory.getAll('agent1');
      expect(entries).toHaveLength(2);
    });
  });

  describe('stats', () => {
    it('should track size', () => {
      memory.set('agent1', 'key1', 'value1');
      memory.set('agent1', 'key2', 'value2');

      expect(memory.getSize()).toBe(2);
      expect(memory.getMaxSize()).toBe(100);
    });

    it('should track hit rate', () => {
      memory.set('agent1', 'key1', 'value1');
      memory.get('agent1', 'key1'); // hit
      memory.get('agent1', 'key1'); // hit
      memory.get('agent1', 'nonexistent'); // miss

      expect(memory.getHitRate()).toBeCloseTo(0.67, 1);
    });

    it('should reset stats', () => {
      memory.set('agent1', 'key1', 'value1');
      memory.get('agent1', 'key1');
      memory.get('agent1', 'nonexistent');
      memory.resetStats();

      expect(memory.getHitRate()).toBe(0);
    });
  });

  describe('createAgentView', () => {
    it('should create a scoped view for an agent', () => {
      const view = memory.createAgentView('agent1');

      view.set('key1', 'value1');
      expect(view.get('key1')).toBe('value1');
      expect(view.has('key1')).toBe(true);

      view.delete('key1');
      expect(view.has('key1')).toBe(false);
    });

    it('should isolate views between agents', () => {
      const view1 = memory.createAgentView('agent1');
      const view2 = memory.createAgentView('agent2');

      view1.set('key', 'value1');
      view2.set('key', 'value2');

      expect(view1.get('key')).toBe('value1');
      expect(view2.get('key')).toBe('value2');
    });
  });
});
