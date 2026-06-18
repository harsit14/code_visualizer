type LogoMarkProps = {
  className?: string;
};

export function LogoMark({ className = 'brand-mark' }: LogoMarkProps) {
  return (
    <img alt="" aria-hidden="true" className={className} src="/brand/step-logo.svg" />
  );
}
