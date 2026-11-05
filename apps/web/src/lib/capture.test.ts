import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { parseCapture } from './capture';

function project(id: string, name: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name,
    status: 'active',
    tags: [],
    links: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

const kitchenId = 'prj_kitchen';
const ps: Project[] = [
  project('prj_old_kitchen', 'Kitchen cupboards', { archived: true }),
  project(kitchenId, 'Kitchen renovation'),
  project('prj_kitchen_2', 'Kitchen garden'),
  project('prj_knysna', 'December in Knysna'),
];

describe('parseCapture', () => {
  it('files the task under the project an @prefix names, and drops the @words', () => {
    expect(parseCapture('Call Pieter @kitch', ps)).toEqual({ title: 'Call Pieter', projectId: kitchenId });
  });

  it('leaves the text as it is when nothing matches', () => {
    expect(parseCapture('Email @nobody', ps)).toEqual({ title: 'Email @nobody' });
  });

  it('takes the longest run of whole words that still matches', () => {
    expect(parseCapture('@kitchen reno call Pieter', ps)).toEqual({ title: 'call Pieter', projectId: kitchenId });
  });

  it('picks the first project in board order when several match', () => {
    expect(parseCapture('Water @kitchen', ps)).toEqual({ title: 'Water', projectId: kitchenId });
    expect(parseCapture('Water @kitchen g', ps)).toEqual({ title: 'Water', projectId: 'prj_kitchen_2' });
  });

  it('never files under an archived project', () => {
    expect(parseCapture('Measure @kitchen cup', ps)).toEqual({ title: 'Measure cup', projectId: kitchenId });
  });

  it('is case-insensitive and matches mid-sentence', () => {
    expect(parseCapture('Book @DECEMBER in the cottage', ps)).toEqual({
      title: 'Book the cottage',
      projectId: 'prj_knysna',
    });
  });

  it('ignores an @ inside a word, such as an email address', () => {
    expect(parseCapture('Mail pieter@kitchen.co.za', ps)).toEqual({ title: 'Mail pieter@kitchen.co.za' });
  });

  it('trims the text', () => {
    expect(parseCapture('  Buy tiles  ', ps)).toEqual({ title: 'Buy tiles' });
  });
});
