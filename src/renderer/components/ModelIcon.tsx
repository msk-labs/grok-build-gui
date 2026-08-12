import { BRAND_LOGO_PATHS } from "../lib/brandLogos";
import { detectBrand } from "../lib/modelBrand";

export type ModelIconProps = {
  modelId: string;
  name?: string;
  /** Box size in px; 18 in menus, 14 on the composer chip. */
  size?: number;
};

/**
 * Vendor logo shown before a model name.
 *
 * Logos are single-colour 24x24 paths tinted with the vendor's accent, so they
 * sit consistently next to the app's own icons. A vendor with no logo on file
 * falls back to a monogram badge rather than a blank space.
 */
export function ModelIcon({ modelId, name, size = 18 }: ModelIconProps) {
  const brand = detectBrand(modelId, name);
  const paths = BRAND_LOGO_PATHS[brand.id];

  if (!paths) {
    return (
      <span
        className="model-icon model-icon-monogram"
        style={{
          width: size,
          height: size,
          background: brand.color,
          fontSize: brand.monogram.length > 1 ? size * 0.42 : size * 0.55,
        }}
        title={brand.label}
        aria-hidden
      >
        {brand.monogram}
      </span>
    );
  }

  return (
    <svg
      className="model-icon model-icon-logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={brand.color}
      fillRule="evenodd"
      clipRule="evenodd"
      role="img"
      aria-label={brand.label}
    >
      <title>{brand.label}</title>
      {paths.map((d) => (
        <path key={d.slice(0, 32)} d={d} />
      ))}
    </svg>
  );
}
