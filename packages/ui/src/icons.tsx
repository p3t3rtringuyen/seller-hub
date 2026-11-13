"use client";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";

// A handful of 24px glyphs (Material path data, Apache-2.0) so the package does not need @mui/icons-material.
function make(d: string, name: string) {
  const Icon = (props: SvgIconProps) => (
    <SvgIcon {...props} data-icon={name}>
      <path d={d} />
    </SvgIcon>
  );
  Icon.displayName = `${name}Icon`;
  return Icon;
}

export const CloseIcon = make(
  "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  "Close",
);
export const SearchIcon = make(
  "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14",
  "Search",
);
export const EditIcon = make(
  "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z",
  "Edit",
);
export const ViewColumnIcon = make(
  "M14.67 5v14H9.33V5zm1 14H21V5h-5.33zm-7.34 0V5H3v14z",
  "ViewColumn",
);
export const PinIcon = make(
  "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3",
  "Pin",
);
export const ArrowUpIcon = make(
  "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8z",
  "ArrowUp",
);
export const ArrowDownIcon = make(
  "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8z",
  "ArrowDown",
);
export const ChevronLeftIcon = make("M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z", "ChevronLeft");
export const ChevronRightIcon = make(
  "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  "ChevronRight",
);
export const MenuIcon = make("M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z", "Menu");
export const CalendarIcon = make(
  "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H5V10h14zM5 8V6h14v2z",
  "Calendar",
);
export const FilterIcon = make("M10 18h4v-2h-4zM3 6v2h18V6zm3 7h12v-2H6z", "Filter");
export const ErrorIcon = make(
  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2zm0-4h-2V7h2z",
  "Error",
);
export const InboxIcon = make(
  "M19 3H4.99C3.89 3 3 3.9 3 5l.01 14c0 1.1.89 2 1.99 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19z",
  "Inbox",
);
export const CopyIcon = make(
  "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z",
  "Copy",
);
export const CheckIcon = make("M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z", "Check");
