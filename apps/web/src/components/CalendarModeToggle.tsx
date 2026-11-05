import { Segmented } from './ui';

export type CalendarMode = 'week' | 'month';

/** The Week/Month segmented pill both HomeCalendar and TasksCalendar mount, styled identically. */
export default function CalendarModeToggle({
  mode,
  onChange,
}: {
  mode: CalendarMode;
  onChange: (mode: CalendarMode) => void;
}) {
  return (
    <Segmented
      ariaLabel="Calendar range"
      value={mode}
      onChange={onChange}
      options={[
        { value: 'week', label: 'Week' },
        { value: 'month', label: 'Month' },
      ]}
    />
  );
}
