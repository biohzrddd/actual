import { styles as actualStyles, colorsn } from '../../style';

const colourStyles = {
  ...actualStyles.lightScrollbar,
  control: styles => ({
    ...styles,
    backgroundColor: colorsn.background,
    border: '1px solid ' + colorsn.primaryAccent,
    borderRadius: 4,
    outline: 0,
    marginLeft: -1,
    marginRight: 1,
    padding: '5px 2px',
    fontSize: '13px',
    minHeight: 'auto',
  }),
  input: styles => ({
    ...styles,
    padding: '0 2px',
    margin: 0,
    overflow: 'hidden',
  }),
  menuPortal: styles => ({
    ...styles,
    zIndex: 5000,
    minWidth: 200,
  }),
  menu: (styles, { selectProps }) => ({
    ...styles,
    minWidth: 200,
    backgroundColor: colorsn.secondary,
    marginTop: 2,
    marginBottom: 2,
    position: selectProps['data-embedded'] ? 'relative' : styles.position,
    overflow: 'hidden',
  }),
  menuList: styles => ({
    ...styles,
    padding: 0,

    // Custom scrollbar styling
    ...Object.entries(actualStyles.lightScrollbar).reduce(
      (carry, [key, value]) => ({
        ...carry,
        [key.replace('& ', '')]: value,
      }),
      {},
    ),
  }),
  group: styles => ({
    ...styles,
    padding: '5px 0 0',
  }),
  groupHeading: styles => ({
    ...styles,
    color: colorsn.secondaryText,
    textTransform: 'none',
    paddingLeft: '9px',
    fontSize: '100%',
    fontWeight: 'bold',
  }),
  option: (styles, { isFocused }) => ({
    ...styles,
    backgroundColor: isFocused ? colorsn.secondaryAccent : colorsn.secondary,
    color: isFocused ? colorsn.secondaryAccentText : colorsn.secondaryText,
    padding: '3px 20px',
    fontSize: 13,
  }),
  valueContainer: (styles, { isMulti, selectProps }) => ({
    ...styles,
    padding: 'none',
    overflow: 'visible',
    marginTop: isMulti && selectProps.value?.length ? -4 : undefined,
    marginBottom: isMulti && selectProps.value?.length ? -4 : undefined,
  }),
  clearIndicator: styles => ({
    ...styles,
    padding: 'none',
    '> svg': { height: 15, width: 15 },
  }),
  multiValue: styles => ({
    ...styles,
    backgroundColor: colorsn.secondaryAccent,
  }),
};

export default colourStyles;
