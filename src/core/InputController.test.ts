import { describe, expect, it, vi } from 'vitest';
import InputController from './InputController';

describe('InputController allowEnterKey', () => {
  it('handles Enter when allowEnterKey is true', () => {
    const ritor = {
      emit: vi.fn(),
      handleEnterKey: vi.fn(),
      handleCharacterInput: vi.fn(),
      handleBackspace: vi.fn(),
      handleDelete: vi.fn(),
      handlePasteText: vi.fn(),
      isEnterKeyAllowed: vi.fn(() => true),
    } as any;

    const controller = new InputController(ritor);
    const event = { key: 'Enter', defaultPrevented: false, preventDefault: vi.fn() } as any;

    controller.handleKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(ritor.handleEnterKey).toHaveBeenCalledTimes(1);
  });

  it('blocks Enter when allowEnterKey is false', () => {
    const ritor = {
      emit: vi.fn(),
      handleEnterKey: vi.fn(),
      handleCharacterInput: vi.fn(),
      handleBackspace: vi.fn(),
      handleDelete: vi.fn(),
      handlePasteText: vi.fn(),
      isEnterKeyAllowed: vi.fn(() => false),
    } as any;

    const controller = new InputController(ritor);
    const event = { key: 'Enter', defaultPrevented: false, preventDefault: vi.fn() } as any;

    controller.handleKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(ritor.handleEnterKey).not.toHaveBeenCalled();
  });

  it('blocks insertParagraph in beforeinput when allowEnterKey is false', () => {
    const ritor = {
      emit: vi.fn(),
      handleEnterKey: vi.fn(),
      handleCharacterInput: vi.fn(),
      handleBackspace: vi.fn(),
      handleDelete: vi.fn(),
      handlePasteText: vi.fn(),
      isEnterKeyAllowed: vi.fn(() => false),
    } as any;

    const controller = new InputController(ritor);
    const event = { inputType: 'insertParagraph', preventDefault: vi.fn() } as any;

    controller.handleBeforeInput(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(ritor.handleEnterKey).not.toHaveBeenCalled();
  });
});
