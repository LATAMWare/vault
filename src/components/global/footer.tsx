interface FooterProps {
    onSectionChange: (section: string) => void
}

const Footer = (props: FooterProps) => {

    const { onSectionChange } = props

    return (
        <div className="absolute z-50 -bottom-12.5 flex w-full justify-center items-center pb-15 px-5">
            <div className="group">
                <button
                    onClick={ () => onSectionChange("legal") }
                    className="cursor-pointer hover:font-inter-bold opacity-30 group-hover:opacity-80 hover:opacity-100 duration-300 text-sm"
                >
                    Legal Notice & Disclaimer
                </button>
            </div>
        </div>
    )

}

export default Footer
