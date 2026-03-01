import * as React from 'react';
import Svg, { Path, SvgProps, Defs, LinearGradient, Stop } from 'react-native-svg';

interface LogoProps extends SvgProps {
    mode?: 'light' | 'dark';
}

export const Logo = ({ mode = 'dark', ...props }: LogoProps) => {
    const isDark = mode === 'dark';

    return (
        <Svg
            width={180}
            height={180}
            viewBox="-33.33 -33.33 266.67 266.67"
            fill="none"
            {...props}
        >
            <Defs>
                {isDark ? (
                    <>
                        <LinearGradient id="grad1" x1="30" y1="40" x2="160" y2="100" gradientUnits="userSpaceOnUse">
                            <Stop offset="0" stopColor="#FFFFFF" />
                            <Stop offset="1" stopColor="#E0E0E0" />
                        </LinearGradient>
                        <LinearGradient id="grad2" x1="60" y1="108" x2="160" y2="160" gradientUnits="userSpaceOnUse">
                            <Stop offset="0" stopColor="#B0B0B0" />
                            <Stop offset="1" stopColor="#808080" />
                        </LinearGradient>
                    </>
                ) : (
                    <>
                        <LinearGradient id="grad1" x1="30" y1="40" x2="160" y2="100" gradientUnits="userSpaceOnUse">
                            <Stop offset="0" stopColor="#000000" />
                            <Stop offset="1" stopColor="#1A1A1A" />
                        </LinearGradient>
                        <LinearGradient id="grad2" x1="60" y1="108" x2="160" y2="160" gradientUnits="userSpaceOnUse">
                            <Stop offset="0" stopColor="#404040" />
                            <Stop offset="1" stopColor="#808080" />
                        </LinearGradient>
                    </>
                )}
            </Defs>
            <Path d="M30 40 L160 100 L50 100 Z" fill="url(#grad1)" />
            <Path d="M60 108 L160 104 L50 160 Z" fill="url(#grad2)" />
        </Svg>
    );
};
