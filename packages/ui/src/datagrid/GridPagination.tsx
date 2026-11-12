"use client";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { grid } from "../tokens";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { useMessages } from "../messages";
import { SkeletonMark } from "./GridSkeleton";

export interface GridPaginationProps {
  pageIndex: number;
  pageSize: number;
  /** Unknown while the first page loads. */
  totalRows: number | undefined;
  loading: boolean;
  pageSizeOptions?: readonly number[];
  onChange: (next: { pageIndex: number; pageSize: number }) => void;
}

/** Always rendered, loading or not: the words are static, only the counts are skeletons (UX-04). */
export function GridPagination({
  pageIndex,
  pageSize,
  totalRows,
  loading,
  pageSizeOptions = grid.defaultPageSizes,
  onChange,
}: GridPaginationProps) {
  const t = useMessages();
  const total = totalRows ?? 0;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  const lastIndex = Math.max(0, Math.ceil(total / pageSize) - 1);
  return (
    <Box
      data-part="pagination"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 2,
        height: 48,
        px: 2,
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Typography variant="body2" color="text.secondary" id="rows-per-page-label">
        {t("grid.rowsPerPage")}
      </Typography>
      <Select
        size="small"
        variant="standard"
        value={pageSize}
        disabled={loading}
        inputProps={{ "aria-labelledby": "rows-per-page-label" }}
        onChange={(e) => onChange({ pageIndex: 0, pageSize: Number(e.target.value) })}
      >
        {pageSizeOptions.map((n) => (
          <MenuItem key={n} value={n}>
            {n}
          </MenuItem>
        ))}
      </Select>
      <Box sx={{ minWidth: 112, display: "flex", justifyContent: "flex-end" }} data-part="range">
        {loading && totalRows === undefined ? (
          <SkeletonMark shape="number" />
        ) : (
          <Typography variant="body2">{t("grid.range", { from, to, total })}</Typography>
        )}
      </Box>
      <IconButton
        size="small"
        aria-label={t("grid.previousPage")}
        disabled={loading || pageIndex <= 0}
        onClick={() => onChange({ pageIndex: pageIndex - 1, pageSize })}
      >
        <ChevronLeftIcon />
      </IconButton>
      <IconButton
        size="small"
        aria-label={t("grid.nextPage")}
        disabled={loading || pageIndex >= lastIndex}
        onClick={() => onChange({ pageIndex: pageIndex + 1, pageSize })}
      >
        <ChevronRightIcon />
      </IconButton>
    </Box>
  );
}
