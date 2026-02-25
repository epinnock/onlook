'use client';

import { cn } from '@onlook/ui/utils';
import type { ReactNode } from 'react';

type IconOption = {
    value: string;
    icon: ReactNode;
    disabled?: boolean;
};

type TextOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

interface InputRadioProps {
    options: (IconOption | TextOption)[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export const InputRadio = ({ options, value, onChange, className }: InputRadioProps) => {
    const isIconOption = (option: IconOption | TextOption): option is IconOption => {
        return 'icon' in option;
    };

    return (
        <div className={cn('flex flex-1', className)}>
            {options.map((option, index) => (
                <button
                    key={option.value}
                    disabled={option.disabled}
                    className={cn(
                        "px-1 h-9 text-sm flex-1 transition-colors",
                        value === option.value
                            ? "bg-background-tertiary text-white"
                            : "bg-background-tertiary/50 text-muted-foreground hover:bg-background-tertiary/70 hover:text-white",
                        option.disabled && "cursor-not-allowed opacity-40 hover:bg-background-tertiary/50 hover:text-muted-foreground",
                        !option.disabled && "cursor-pointer",
                        index === 0 && "rounded-l-md",
                        index === options.length - 1 && "rounded-r-md"
                    )}
                    onClick={() => {
                        if (!option.disabled) {
                            onChange(option.value);
                        }
                    }}
                >
                    {isIconOption(option) ? (
                        <div className="mx-auto w-fit">{option.icon}</div>
                    ) : (
                        option.label
                    )}
                </button>
            ))}
        </div>
    );
};
