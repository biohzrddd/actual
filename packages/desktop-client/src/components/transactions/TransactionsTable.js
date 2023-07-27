import React, {
  createContext,
  createElement,
  createRef,
  forwardRef,
  memo,
  useState,
  useRef,
  useMemo,
  useCallback,
  useLayoutEffect,
  useEffect,
  useContext,
  useReducer,
} from 'react';
import { useSelector, useDispatch } from 'react-redux';

import {
  format as formatDate,
  parseISO,
  isValid as isDateValid,
} from 'date-fns';

import { useCachedSchedules } from 'loot-core/src/client/data-hooks/schedules';
import {
  getAccountsById,
  getPayeesById,
  getCategoriesById,
} from 'loot-core/src/client/reducers/queries';
import evalArithmetic from 'loot-core/src/shared/arithmetic';
import { currentDay } from 'loot-core/src/shared/months';
import { getScheduledAmount } from 'loot-core/src/shared/schedules';
import {
  splitTransaction,
  updateTransaction,
  deleteTransaction,
  addSplitTransaction,
} from 'loot-core/src/shared/transactions';
import {
  integerToCurrency,
  amountToInteger,
  titleFirst,
} from 'loot-core/src/shared/util';

import { useMergedRefs } from '../../hooks/useMergedRefs';
import usePrevious from '../../hooks/usePrevious';
import { useSelectedDispatch, useSelectedItems } from '../../hooks/useSelected';
import LeftArrow2 from '../../icons/v0/LeftArrow2';
import RightArrow2 from '../../icons/v0/RightArrow2';
import ArrowDown from '../../icons/v1/ArrowDown';
import ArrowUp from '../../icons/v1/ArrowUp';
import CheveronDown from '../../icons/v1/CheveronDown';
import ArrowsSynchronize from '../../icons/v2/ArrowsSynchronize';
import CalendarIcon from '../../icons/v2/Calendar';
import Hyperlink2 from '../../icons/v2/Hyperlink2';
import { styles, colors } from '../../style';
import AccountAutocomplete from '../autocomplete/AccountAutocomplete';
import CategoryAutocomplete from '../autocomplete/CategorySelect';
import PayeeAutocomplete from '../autocomplete/PayeeAutocomplete';
import { View, Text, Tooltip, Button } from '../common';
import { getStatusProps } from '../schedules/StatusBadge';
import { TransactionPreviewPicker } from '../schedules/TransactionPreviewPicker';
import DateSelect from '../select/DateSelect';
import {
  Cell,
  Field,
  Row,
  InputCell,
  SelectCell,
  DeleteCell,
  CustomCell,
  CellButton,
  useTableNavigator,
  Table,
  UnexposedCellContent,
} from '../table';

function getDisplayValue(obj, name) {
  return obj ? obj[name] : '';
}

function serializeTransaction(transaction, showZeroInDeposit) {
  let { amount, date } = transaction;

  if (isPreviewId(transaction.id)) {
    amount = (transaction._inverse ? -1 : 1) * getScheduledAmount(amount);
  }

  let debit = amount < 0 ? -amount : null;
  let credit = amount > 0 ? amount : null;

  if (amount === 0) {
    if (showZeroInDeposit) {
      credit = 0;
    } else {
      debit = 0;
    }
  }

  // Validate the date format
  if (!isDateValid(parseISO(date))) {
    // Be a little forgiving if the date isn't valid. This at least
    // stops the UI from crashing, but this is a serious problem with
    // the data. This allows the user to go through and see empty
    // dates and manually fix them.
    date = null;
  }

  return {
    ...transaction,
    date,
    debit: debit != null ? integerToCurrency(debit) : '',
    credit: credit != null ? integerToCurrency(credit) : '',
  };
}

function deserializeTransaction(transaction, originalTransaction) {
  let { debit, credit, date, ...realTransaction } = transaction;

  let amount;
  if (debit !== '') {
    let parsed = evalArithmetic(debit, null);
    amount = parsed != null ? -parsed : null;
  } else {
    amount = evalArithmetic(credit, null);
  }

  amount =
    amount != null ? amountToInteger(amount) : originalTransaction.amount;

  if (date == null) {
    date = originalTransaction.date || currentDay();
  }

  return { ...realTransaction, date, amount };
}

function isLastChild(transactions, index) {
  let trans = transactions[index];
  return (
    trans &&
    trans.is_child &&
    (transactions[index + 1] == null ||
      transactions[index + 1].parent_id !== trans.parent_id)
  );
}

let SplitsExpandedContext = createContext(null);

export function useSplitsExpanded() {
  let data = useContext(SplitsExpandedContext);

  return useMemo(
    () => ({
      ...data,
      expanded: id =>
        data.state.mode === 'collapse'
          ? !data.state.ids.has(id)
          : data.state.ids.has(id),
    }),
    [data],
  );
}

export function SplitsExpandedProvider({ children, initialMode = 'expand' }) {
  let cachedState = useSelector(state => state.app.lastSplitState);
  let reduxDispatch = useDispatch();

  let [state, dispatch] = useReducer((state, action) => {
    switch (action.type) {
      case 'toggle-split': {
        let ids = new Set([...state.ids]);
        let { id } = action;
        if (ids.has(id)) {
          ids.delete(id);
        } else {
          ids.add(id);
        }
        return { ...state, ids };
      }
      case 'open-split': {
        let ids = new Set([...state.ids]);
        let { id } = action;
        if (state.mode === 'collapse') {
          ids.delete(id);
        } else {
          ids.add(id);
        }
        return { ...state, ids };
      }
      case 'set-mode': {
        return {
          ...state,
          mode: action.mode,
          ids: new Set(),
          transitionId: null,
        };
      }
      case 'switch-mode':
        if (state.transitionId != null) {
          // You can only transition once at a time
          return state;
        }

        return {
          ...state,
          mode: state.mode === 'expand' ? 'collapse' : 'expand',
          transitionId: action.id,
          ids: new Set(),
        };
      case 'finish-switch-mode':
        return { ...state, transitionId: null };
      default:
        throw new Error('Unknown action type: ' + action.type);
    }
  }, cachedState.current || { ids: new Set(), mode: initialMode });

  useEffect(() => {
    if (state.transitionId != null) {
      // This timeout allows animations to finish
      setTimeout(() => {
        dispatch({ type: 'finish-switch-mode' });
      }, 250);
    }
  }, [state.transitionId]);

  useEffect(() => {
    // In a finished state, cache the state
    if (state.transitionId == null) {
      reduxDispatch({ type: 'SET_LAST_SPLIT_STATE', splitState: state });
    }
  }, [state]);

  let value = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <SplitsExpandedContext.Provider value={value}>
      {children}
    </SplitsExpandedContext.Provider>
  );
}

function selectAscDesc(field, ascDesc, clicked, defaultAscDesc = 'asc') {
  return field === clicked
    ? ascDesc === 'asc'
      ? 'desc'
      : 'asc'
    : defaultAscDesc;
}

const TransactionHeader = memo(
  ({
    hasSelected,
    showAccount,
    showCategory,
    showBalance,
    showCleared,
    scrollWidth,
    onSort,
    ascDesc,
    field,
  }) => {
    let dispatchSelected = useSelectedDispatch();

    return (
      <Row
        borderColor={colors.n9}
        backgroundColor="white"
        style={{
          color: colors.n4,
          fontWeight: 300,
          zIndex: 200,
        }}
      >
        <SelectCell
          exposed={true}
          focused={false}
          selected={hasSelected}
          width={20}
          onSelect={e => dispatchSelected({ type: 'select-all', event: e })}
        />
        <HeaderCell
          value="Date"
          width={110}
          alignItems="flex"
          marginLeft={-5}
          id="date"
          icon={field === 'date' ? ascDesc : 'clickable'}
          onClick={() =>
            onSort('date', selectAscDesc(field, ascDesc, 'date', 'desc'))
          }
        />
        {showAccount && (
          <HeaderCell
            value="Account"
            width="flex"
            alignItems="flex"
            marginLeft={-5}
            id="account"
            icon={field === 'account' ? ascDesc : 'clickable'}
            onClick={() =>
              onSort('account', selectAscDesc(field, ascDesc, 'account', 'asc'))
            }
          />
        )}
        <HeaderCell
          value="Payee"
          width="flex"
          alignItems="flex"
          marginLeft={-5}
          id="payee"
          icon={field === 'payee' ? ascDesc : 'clickable'}
          onClick={() =>
            onSort('payee', selectAscDesc(field, ascDesc, 'payee', 'asc'))
          }
        />
        <HeaderCell
          value="Notes"
          width="flex"
          alignItems="flex"
          marginLeft={-5}
          id="notes"
          icon={field === 'notes' ? ascDesc : 'clickable'}
          onClick={() =>
            onSort('notes', selectAscDesc(field, ascDesc, 'notes', 'asc'))
          }
        />
        {showCategory && (
          <HeaderCell
            value="Category"
            width="flex"
            alignItems="flex"
            marginLeft={-5}
            id="category"
            icon={field === 'category' ? ascDesc : 'clickable'}
            onClick={() =>
              onSort(
                'category',
                selectAscDesc(field, ascDesc, 'category', 'asc'),
              )
            }
          />
        )}
        <HeaderCell
          value="Payment"
          width={90}
          alignItems="flex-end"
          marginRight={-5}
          id="payment"
          icon={field === 'payment' ? ascDesc : 'clickable'}
          onClick={() =>
            onSort('payment', selectAscDesc(field, ascDesc, 'payment', 'asc'))
          }
        />
        <HeaderCell
          value="Deposit"
          width={85}
          alignItems="flex-end"
          marginRight={-5}
          id="deposit"
          icon={field === 'deposit' ? ascDesc : 'clickable'}
          onClick={() =>
            onSort('deposit', selectAscDesc(field, ascDesc, 'deposit', 'desc'))
          }
        />
        {showBalance && <Cell value="Balance" width={88} textAlign="right" />}
        {showCleared && <Field width={30} truncate={false} />}
        <Cell value="" width={5 + scrollWidth ?? 0} />
      </Row>
    );
  },
);

function getPayeePretty(transaction, payee, transferAcct) {
  let { payee: payeeId } = transaction;

  if (transferAcct) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {transferAcct.name}
        </div>
      </View>
    );
  } else if (payee && !payee.transfer_acct) {
    // Check to make sure this isn't a transfer because in the rare
    // occasion that the account has been deleted but the payee is
    // still there, we don't want to show the name.
    return payee.name;
  } else if (payeeId && payeeId.startsWith('new:')) {
    return payeeId.slice('new:'.length);
  }

  return '';
}

function StatusCell({
  id,
  focused,
  selected,
  status,
  isChild,
  onEdit,
  onUpdate,
}) {
  let isClearedField = status === 'cleared' || status == null;
  let statusProps = getStatusProps(status);

  let props = {
    color:
      status === 'cleared'
        ? colors.g5
        : status === 'missed'
        ? colors.r6
        : status === 'due'
        ? colors.y5
        : selected
        ? colors.b7
        : colors.n7,
  };

  function onSelect() {
    if (isClearedField) {
      onUpdate('cleared', !(status === 'cleared'));
    }
  }

  return (
    <Cell
      name="cleared"
      width={23}
      focused={focused}
      style={{ padding: 1 }}
      plain
    >
      <CellButton
        style={[
          {
            padding: 3,
            border: '1px solid transparent',
            borderRadius: 50,
            ':focus': {
              border: '1px solid ' + props.color,
              boxShadow: `0 1px 2px ${props.color}`,
            },
            cursor: isClearedField ? 'pointer' : 'default',
          },

          isChild && { visibility: 'hidden' },
        ]}
        onEdit={() => onEdit(id, 'cleared')}
        onSelect={onSelect}
      >
        {createElement(statusProps.Icon, {
          style: {
            width: 13,
            height: 13,
            color: props.color,
            marginTop: status === 'due' ? -1 : 0,
          },
        })}
      </CellButton>
    </Cell>
  );
}

function HeaderCell({
  value,
  id,
  width,
  alignItems,
  marginLeft,
  marginRight,
  icon,
  onClick,
}) {
  return (
    <CustomCell
      width={width}
      name={id}
      alignItems={alignItems}
      unexposedContent={
        <Button
          type="bare"
          onClick={onClick}
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: colors.n4,
            fontWeight: 300,
            marginLeft: marginLeft,
            marginRight: marginRight,
          }}
        >
          <UnexposedCellContent value={value} />
          {icon === 'asc' && (
            <ArrowDown width={10} height={10} style={{ marginLeft: 5 }} />
          )}
          {icon === 'desc' && (
            <ArrowUp width={10} height={10} style={{ marginLeft: 5 }} />
          )}
        </Button>
      }
    />
  );
}

function PayeeCell({
  id,
  payeeId,
  accountId,
  focused,
  inherited,
  payees,
  accounts,
  valueStyle,
  transaction,
  payee,
  transferAcct,
  isPreview,
  onEdit,
  onUpdate,
  onCreatePayee,
  onManagePayees,
  onNavigateToTransferAccount,
  onNavigateToSchedule,
}) {
  let isCreatingPayee = useRef(false);

  // Filter out the account we're currently in as it is not a valid transfer
  accounts = accounts.filter(account => account.id !== accountId);
  payees = payees.filter(payee => payee.transfer_acct !== accountId);

  return (
    <CustomCell
      width="flex"
      name="payee"
      textAlign="flex"
      value={payeeId}
      valueStyle={[valueStyle, inherited && { color: colors.n8 }]}
      exposed={focused}
      onExpose={name => !isPreview && onEdit(id, name)}
      onUpdate={async value => {
        onUpdate('payee', value);

        if (value && value.startsWith('new:') && !isCreatingPayee.current) {
          isCreatingPayee.current = true;
          let id = await onCreatePayee(value.slice('new:'.length));
          onUpdate('payee', id);
          isCreatingPayee.current = false;
        }
      }}
      unexposedContent={
        <>
          <PayeeIcons
            transaction={transaction}
            transferAccount={transferAcct}
            onNavigateToTransferAccount={onNavigateToTransferAccount}
            onNavigateToSchedule={onNavigateToSchedule}
          />
          <UnexposedCellContent
            value={payeeId}
            formatter={() => getPayeePretty(transaction, payee, transferAcct)}
          />
        </>
      }
    >
      {({
        onBlur,
        onKeyDown,
        onUpdate,
        onSave,
        shouldSaveFromKey,
        inputStyle,
      }) => {
        return (
          <PayeeAutocomplete
            payees={payees}
            accounts={accounts}
            value={payeeId}
            shouldSaveFromKey={shouldSaveFromKey}
            inputProps={{
              onBlur,
              onKeyDown,
              style: inputStyle,
            }}
            showManagePayees={true}
            tableBehavior={true}
            defaultFocusTransferPayees={transaction.is_child}
            focused={true}
            onUpdate={onUpdate}
            onSelect={onSave}
            onManagePayees={() => onManagePayees(payeeId)}
            isCreatable
            menuPortalTarget={undefined}
          />
        );
      }}
    </CustomCell>
  );
}

function PayeeIcons({
  transaction,
  transferAccount,
  onNavigateToTransferAccount,
  onNavigateToSchedule,
  children,
}) {
  let scheduleId = transaction.schedule;
  let scheduleData = useCachedSchedules();
  let schedule = scheduleData
    ? scheduleData.schedules.find(s => s.id === scheduleId)
    : null;

  if (schedule == null && transferAccount == null) {
    // Neither a valid scheduled transaction nor a transfer.
    return children;
  }

  let buttonStyle = {
    marginLeft: -5,
    marginRight: 2,
    width: 23,
    height: 23,
    color: 'inherit',
  };

  let scheduleIconStyle = { width: 13, height: 13 };

  let transferIconStyle = { width: 10, height: 10 };

  let recurring = schedule && schedule._date && !!schedule._date.frequency;

  return schedule ? (
    <Button
      type="bare"
      style={buttonStyle}
      onClick={e => {
        e.stopPropagation();
        onNavigateToSchedule(scheduleId);
      }}
    >
      {recurring ? (
        <ArrowsSynchronize style={scheduleIconStyle} />
      ) : (
        <CalendarIcon style={scheduleIconStyle} />
      )}
    </Button>
  ) : transferAccount ? (
    <Button
      type="bare"
      style={buttonStyle}
      onClick={e => {
        e.stopPropagation();
        if (!isTemporaryId(transaction.id)) {
          onNavigateToTransferAccount(transferAccount.id);
        }
      }}
    >
      {(transaction._inverse ? -1 : 1) * transaction.amount > 0 ? (
        <LeftArrow2 style={transferIconStyle} />
      ) : (
        <RightArrow2 style={transferIconStyle} />
      )}
    </Button>
  ) : null;
}

const Transaction = memo(function Transaction(props) {
  let {
    isNew = false,
    transaction: originalTransaction,
    editing,
    backgroundColor = 'white',
    showAccount,
    showBalance,
    showCleared,
    showZeroInDeposit,
    style,
    selected,
    highlighted,
    added,
    matched,
    expanded,
    inheritedFields,
    focusedField,
    categoryGroups,
    payees,
    accounts,
    balance,
    dateFormat = 'MM/dd/yyyy',
    hideFraction,
    onSave,
    onEdit,
    onDelete,
    onSplit,
    onManagePayees,
    onCreatePayee,
    onToggleSplit,
    onNavigateToTransferAccount,
    onNavigateToSchedule,
  } = props;

  let dispatchSelected = useSelectedDispatch();

  let [hovered, setHovered] = useState(showZeroInDeposit);
  let [prevShowZero, setPrevShowZero] = useState(showZeroInDeposit);
  let [prevTransaction, setPrevTransaction] = useState(originalTransaction);
  let [transaction, setTransaction] = useState(() =>
    serializeTransaction(originalTransaction, showZeroInDeposit),
  );
  let isPreview = isPreviewId(transaction.id);

  let isPreviewSetting = isPreviewSettingId(transaction.id);

  if (
    originalTransaction !== prevTransaction ||
    showZeroInDeposit !== prevShowZero
  ) {
    setTransaction(
      serializeTransaction(originalTransaction, showZeroInDeposit),
    );
    setPrevTransaction(originalTransaction);
    setPrevShowZero(showZeroInDeposit);
  }

  function onUpdate(name, value) {
    if (transaction[name] !== value) {
      let newTransaction = { ...transaction, [name]: value };

      // Don't change the note to an empty string if it's null (since they are both rendered the same)
      if (name === 'note' && value === '' && transaction.note == null) {
        return;
      }

      if (
        name === 'account' &&
        value &&
        getAccountsById(accounts)[value].offbudget
      ) {
        newTransaction.category = null;
      }

      // If entering an amount in either of the credit/debit fields, we
      // need to clear out the other one so it's always properly
      // translated into the desired amount (see
      // `deserializeTransaction`)
      if (name === 'credit') {
        newTransaction['debit'] = '';
      } else if (name === 'debit') {
        newTransaction['credit'] = '';
      }

      // Don't save a temporary value (a new payee) which will be
      // filled in with a real id later
      if (name === 'payee' && value && value.startsWith('new:')) {
        setTransaction(newTransaction);
      } else {
        let deserialized = deserializeTransaction(
          newTransaction,
          originalTransaction,
        );
        // Run the transaction through the formatting so that we know
        // it's always showing the formatted result
        setTransaction(serializeTransaction(deserialized, showZeroInDeposit));
        onSave(deserialized);
      }
    }
  }

  let {
    id,
    debit,
    credit,
    payee: payeeId,
    imported_payee: importedPayee,
    notes,
    date,
    account: accountId,
    category: categoryId,
    cleared,
    is_parent: isParent,
    _unmatched = false,
    _inverse = false,
  } = transaction;

  // Join in some data
  let payee = payees && payeeId && getPayeesById(payees)[payeeId];
  let account = accounts && accountId && getAccountsById(accounts)[accountId];
  let transferAcct;

  if (_inverse) {
    transferAcct =
      accounts && accountId && getAccountsById(accounts)[accountId];
  } else {
    transferAcct =
      payee &&
      payee.transfer_acct &&
      getAccountsById(accounts)[payee.transfer_acct];
  }

  let isChild = transaction.is_child;
  let borderColor = selected ? colors.b8 : colors.border;
  let isBudgetTransfer = transferAcct && transferAcct.offbudget === 0;
  let isOffBudget = account && account.offbudget === 1;

  let valueStyle = added ? { fontWeight: 600 } : null;
  let backgroundFocus = hovered || focusedField === 'select';
  let amountStyle = hideFraction ? { letterSpacing: -0.5 } : null;

  return isPreviewSetting ? (
    <TransactionPreviewPicker
      transaction={transaction}
      onHover={onHover}
      selected={selected}
    />
  ) : (
    <Row
      borderColor={borderColor}
      backgroundColor={
        selected
          ? colors.selected
          : backgroundFocus
          ? colors.hover
          : isPreview
          ? '#fcfcfc'
          : backgroundColor
      }
      highlighted={highlighted}
      style={[
        style,
        isPreview && { color: colors.n5, fontStyle: 'italic' },
        _unmatched && { opacity: 0.5 },
      ]}
      onMouseEnter={() => !isNew && setHovered(true)}
      onMouseLeave={() => !isNew && setHovered(false)}
    >
      {isChild && (
        <Field
          borderColor="transparent"
          width={110}
          style={{
            width: 110,
            backgroundColor: colors.n11,
            borderBottomWidth: 0,
          }}
        />
      )}
      {isChild && showAccount && (
        <Field
          borderColor="transparent"
          style={{
            flex: 1,
            backgroundColor: colors.n11,
            opacity: 0,
          }}
        />
      )}

      {isTemporaryId(transaction.id) ? (
        isChild ? (
          <DeleteCell
            onDelete={() => onDelete && onDelete(transaction.id)}
            exposed={hovered || editing}
            style={[isChild && { borderLeftWidth: 1 }, { lineHeight: 0 }]}
          />
        ) : (
          <Cell width={20} />
        )
      ) : (
        <SelectCell
          exposed={hovered || selected || editing}
          focused={focusedField === 'select'}
          onSelect={e => {
            dispatchSelected({ type: 'select', id: transaction.id, event: e });
          }}
          onEdit={() => onEdit(id, 'select')}
          selected={selected}
          style={[isChild && { borderLeftWidth: 1 }]}
          value={
            matched && (
              <Hyperlink2 style={{ width: 13, height: 13, color: colors.n7 }} />
            )
          }
        />
      )}

      {!isChild && (
        <CustomCell
          name="date"
          width={110}
          textAlign="flex"
          exposed={focusedField === 'date'}
          value={date}
          valueStyle={valueStyle}
          formatter={date =>
            date ? formatDate(parseISO(date), dateFormat) : ''
          }
          onExpose={name => !isPreview && onEdit(id, name)}
          onUpdate={value => {
            onUpdate('date', value);
          }}
        >
          {({
            onBlur,
            onKeyDown,
            onUpdate,
            onSave,
            shouldSaveFromKey,
            inputStyle,
          }) => (
            <DateSelect
              value={date || ''}
              dateFormat={dateFormat}
              inputProps={{ onBlur, onKeyDown, style: inputStyle }}
              shouldSaveFromKey={shouldSaveFromKey}
              tableBehavior={true}
              onUpdate={onUpdate}
              onSelect={onSave}
            />
          )}
        </CustomCell>
      )}

      {!isChild && showAccount && (
        <CustomCell
          name="account"
          width="flex"
          textAlign="flex"
          value={accountId}
          formatter={acctId => {
            let acct = acctId && getAccountsById(accounts)[acctId];
            if (acct) {
              return acct.name;
            }
            return '';
          }}
          valueStyle={valueStyle}
          exposed={focusedField === 'account'}
          onExpose={name => !isPreview && onEdit(id, name)}
          onUpdate={async value => {
            // Only ever allow non-null values
            if (value) {
              onUpdate('account', value);
            }
          }}
        >
          {({
            onBlur,
            onKeyDown,
            onUpdate,
            onSave,
            shouldSaveFromKey,
            inputStyle,
          }) => (
            <AccountAutocomplete
              includeClosedAccounts={false}
              value={accountId}
              accounts={accounts}
              shouldSaveFromKey={shouldSaveFromKey}
              tableBehavior={true}
              focused={true}
              inputProps={{ onBlur, onKeyDown, style: inputStyle }}
              onUpdate={onUpdate}
              onSelect={onSave}
              menuPortalTarget={undefined}
            />
          )}
        </CustomCell>
      )}
      {(() => (
        <PayeeCell
          id={id}
          payeeId={payeeId}
          accountId={accountId}
          focused={focusedField === 'payee'}
          inherited={inheritedFields && inheritedFields.has('payee')}
          payees={payees}
          accounts={accounts}
          valueStyle={valueStyle}
          transaction={transaction}
          payee={payee}
          transferAcct={transferAcct}
          importedPayee={importedPayee}
          isPreview={isPreview}
          onEdit={onEdit}
          onUpdate={onUpdate}
          onCreatePayee={onCreatePayee}
          onManagePayees={onManagePayees}
          onNavigateToTransferAccount={onNavigateToTransferAccount}
          onNavigateToSchedule={onNavigateToSchedule}
        />
      ))()}

      {isPreview ? (
        <Cell name="notes" width="flex" />
      ) : (
        <InputCell
          width="flex"
          name="notes"
          textAlign="flex"
          exposed={focusedField === 'notes'}
          focused={focusedField === 'notes'}
          value={notes || ''}
          valueStyle={valueStyle}
          onExpose={name => !isPreview && onEdit(id, name)}
          inputProps={{
            value: notes || '',
            onUpdate: onUpdate.bind(null, 'notes'),
          }}
        />
      )}

      {isPreview ? (
        <Cell width="flex" style={{ alignItems: 'flex-start' }} exposed={true}>
          {() => (
            <View
              style={{
                color:
                  notes === 'missed'
                    ? colors.r6
                    : notes === 'due'
                    ? colors.y4
                    : selected
                    ? colors.b5
                    : colors.n6,
                backgroundColor:
                  notes === 'missed'
                    ? colors.r10
                    : notes === 'due'
                    ? colors.y9
                    : selected
                    ? colors.b8
                    : colors.n10,
                margin: '0 5px',
                padding: '3px 7px',
                borderRadius: 4,
              }}
            >
              {titleFirst(notes)}
            </View>
          )}
        </Cell>
      ) : isParent ? (
        <Cell
          name="category"
          width="flex"
          focused={focusedField === 'category'}
          style={{ padding: 0 }}
          plain
        >
          <CellButton
            style={{
              alignSelf: 'flex-start',
              color: colors.n6,
              borderRadius: 4,
              transition: 'none',
              '&:hover': {
                backgroundColor: 'rgba(100, 100, 100, .15)',
                color: colors.n5,
              },
            }}
            disabled={isTemporaryId(transaction.id)}
            onEdit={() => onEdit(id, 'category')}
            onSelect={() => onToggleSplit(id)}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                alignSelf: 'stretch',
                borderRadius: 4,
                flex: 1,
                padding: 4,
              }}
            >
              {isParent && (
                <CheveronDown
                  style={{
                    width: 14,
                    height: 14,
                    transition: 'transform .08s',
                    transform: expanded ? 'rotateZ(0)' : 'rotateZ(-90deg)',
                  }}
                />
              )}
              <Text style={{ fontStyle: 'italic', userSelect: 'none' }}>
                Split
              </Text>
            </View>
          </CellButton>
        </Cell>
      ) : isBudgetTransfer || isOffBudget || isPreview ? (
        <InputCell
          name="category"
          width="flex"
          exposed={focusedField === 'category'}
          focused={focusedField === 'category'}
          onExpose={name => !isPreview && onEdit(id, name)}
          value={
            isParent
              ? 'Split'
              : isOffBudget
              ? 'Off Budget'
              : isBudgetTransfer
              ? 'Transfer'
              : ''
          }
          valueStyle={valueStyle}
          style={{
            fontStyle: 'italic',
            color: '#c0c0c0',
            fontWeight: 300,
          }}
          inputProps={{
            readOnly: true,
            style: { fontStyle: 'italic' },
          }}
        />
      ) : (
        <CustomCell
          name="category"
          width="flex"
          textAlign="flex"
          value={categoryId}
          formatter={value =>
            value
              ? getDisplayValue(
                  getCategoriesById(categoryGroups)[value],
                  'name',
                )
              : transaction.id
              ? 'Categorize'
              : ''
          }
          exposed={focusedField === 'category'}
          onExpose={name => onEdit(id, name)}
          valueStyle={
            !categoryId
              ? {
                  fontStyle: 'italic',
                  fontWeight: 300,
                  color: colors.p8,
                }
              : valueStyle
          }
          onUpdate={async value => {
            if (value === 'split') {
              onSplit(transaction.id);
            } else {
              onUpdate('category', value);
            }
          }}
        >
          {({
            onBlur,
            onKeyDown,
            onUpdate,
            onSave,
            shouldSaveFromKey,
            inputStyle,
          }) => (
            <CategoryAutocomplete
              categoryGroups={categoryGroups}
              value={categoryId}
              focused={true}
              tableBehavior={true}
              showSplitOption={!isChild && !isParent}
              shouldSaveFromKey={shouldSaveFromKey}
              inputProps={{ onBlur, onKeyDown, style: inputStyle }}
              onUpdate={onUpdate}
              onSelect={onSave}
              menuPortalTarget={undefined}
            />
          )}
        </CustomCell>
      )}

      <InputCell
        type="input"
        width={90}
        name="debit"
        exposed={focusedField === 'debit'}
        focused={focusedField === 'debit'}
        value={debit === '' && credit === '' ? '0.00' : debit}
        valueStyle={valueStyle}
        textAlign="right"
        title={debit}
        onExpose={name => !isPreview && onEdit(id, name)}
        style={[isParent && { fontStyle: 'italic' }, styles.tnum, amountStyle]}
        inputProps={{
          value: debit === '' && credit === '' ? '0.00' : debit,
          onUpdate: onUpdate.bind(null, 'debit'),
        }}
        privacyFilter={{
          activationFilters: [!isTemporaryId(transaction.id)],
        }}
      />

      <InputCell
        type="input"
        width={85}
        name="credit"
        exposed={focusedField === 'credit'}
        focused={focusedField === 'credit'}
        value={credit}
        valueStyle={valueStyle}
        textAlign="right"
        title={credit}
        onExpose={name => !isPreview && onEdit(id, name)}
        style={[isParent && { fontStyle: 'italic' }, styles.tnum, amountStyle]}
        inputProps={{
          value: credit,
          onUpdate: onUpdate.bind(null, 'credit'),
        }}
        privacyFilter={{
          activationFilters: [!isTemporaryId(transaction.id)],
        }}
      />

      {showBalance && (
        <Cell
          name="balance"
          value={balance == null || isChild ? '' : integerToCurrency(balance)}
          valueStyle={{ color: balance < 0 ? colors.r4 : colors.g4 }}
          style={[styles.tnum, amountStyle]}
          width={88}
          textAlign="right"
          privacyFilter
        />
      )}

      {showCleared && (
        <StatusCell
          id={id}
          focused={focusedField === 'cleared'}
          selected={selected}
          isPreview={isPreview}
          status={isPreview ? notes : cleared ? 'cleared' : null}
          isChild={isChild}
          onEdit={onEdit}
          onUpdate={onUpdate}
        />
      )}

      <Cell width={5} />
    </Row>
  );
});

function TransactionError({ error, isDeposit, onAddSplit, style }) {
  switch (error.type) {
    case 'SplitTransactionError':
      if (error.version === 1) {
        return (
          <View
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                padding: '0 5px',
              },
              style,
            ]}
            data-testid="transaction-error"
          >
            <Text>
              Amount left:{' '}
              <Text style={{ fontWeight: 500 }}>
                {integerToCurrency(
                  isDeposit ? error.difference : -error.difference,
                )}
              </Text>
            </Text>
            <View style={{ flex: 1 }} />
            <Button
              type="primary"
              style={{ marginLeft: 15, padding: '4px 10px' }}
              onClick={onAddSplit}
            >
              Add Split
            </Button>
          </View>
        );
      }
      break;
    default:
      return null;
  }
}

function makeTemporaryTransactions(
  currentAccountId,
  currentCategoryId,
  lastDate,
) {
  return [
    {
      id: 'temp',
      date: lastDate || currentDay(),
      account: currentAccountId || null,
      category: currentCategoryId || null,
      cleared: false,
      amount: null,
    },
  ];
}

function isTemporaryId(id) {
  return id.indexOf('temp') !== -1;
}

function isPreviewSettingId(id) {
  return id.indexOf('previewSetting/') !== -1;
}

export function isPreviewId(id) {
  return id.indexOf('preview/') !== -1;
}

function NewTransaction({
  transactions,
  accounts,
  categoryGroups,
  payees,
  editingTransaction,
  focusedField,
  showAccount,
  showCategory,
  showBalance,
  showCleared,
  dateFormat,
  hideFraction,
  onClose,
  onSplit,
  onEdit,
  onDelete,
  onSave,
  onAdd,
  onAddSplit,
  onManagePayees,
  onCreatePayee,
  onNavigateToTransferAccount,
  onNavigateToSchedule,
}) {
  const error = transactions[0].error;
  const isDeposit = transactions[0].amount > 0;

  return (
    <View
      style={{
        borderBottom: '1px solid #ebebeb',
        paddingBottom: 6,
        backgroundColor: 'white',
      }}
      data-testid="new-transaction"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
    >
      {transactions.map((transaction, idx) => (
        <Transaction
          isNew
          key={transaction.id}
          editing={editingTransaction === transaction.id}
          transaction={transaction}
          showAccount={showAccount}
          showCategory={showCategory}
          showBalance={showBalance}
          showCleared={showCleared}
          focusedField={editingTransaction === transaction.id && focusedField}
          showZeroInDeposit={isDeposit}
          accounts={accounts}
          categoryGroups={categoryGroups}
          payees={payees}
          dateFormat={dateFormat}
          hideFraction={hideFraction}
          expanded={true}
          onEdit={onEdit}
          onSave={onSave}
          onSplit={onSplit}
          onDelete={onDelete}
          onAdd={onAdd}
          onManagePayees={onManagePayees}
          onCreatePayee={onCreatePayee}
          style={{ marginTop: -1 }}
          onNavigateToTransferAccount={onNavigateToTransferAccount}
          onNavigateToSchedule={onNavigateToSchedule}
        />
      ))}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginTop: 6,
          marginRight: 20,
        }}
      >
        <Button
          style={{ marginRight: 10, padding: '4px 10px' }}
          onClick={() => onClose()}
          data-testid="cancel-button"
        >
          Cancel
        </Button>
        {error ? (
          <TransactionError
            error={error}
            isDeposit={isDeposit}
            onAddSplit={() => onAddSplit(transactions[0].id)}
          />
        ) : (
          <Button
            type="primary"
            style={{ padding: '4px 10px' }}
            onClick={onAdd}
            data-testid="add-button"
          >
            Add
          </Button>
        )}
      </View>
    </View>
  );
}

function TransactionTableInner({
  tableNavigator,
  tableRef,
  dateFormat = 'MM/dd/yyyy',
  newNavigator,
  renderEmpty,
  onScroll,
  ...props
}) {
  const containerRef = createRef();
  const isAddingPrev = usePrevious(props.isAdding);
  let [scrollWidth, setScrollWidth] = useState(0);

  function saveScrollWidth(parent, child) {
    let width = parent > 0 && child > 0 && parent - child;

    setScrollWidth(!width ? 0 : width);
  }

  let onNavigateToTransferAccount = useCallback(
    accountId => {
      props.onCloseAddTransaction();
      props.onNavigateToTransferAccount(accountId);
    },
    [props.onCloseAddTransaction, props.onNavigateToTransferAccount],
  );

  let onNavigateToSchedule = useCallback(
    scheduleId => {
      props.onCloseAddTransaction();
      props.onNavigateToSchedule(scheduleId);
    },
    [props.onCloseAddTransaction, props.onNavigateToSchedule],
  );

  useEffect(() => {
    if (!isAddingPrev && props.isAdding) {
      newNavigator.onEdit('temp', 'date');
    }
  }, [isAddingPrev, props.isAdding, newNavigator]);

  const renderRow = ({ item, index, position, editing }) => {
    const {
      transactions,
      selectedItems,
      accounts,
      categoryGroups,
      payees,
      showCleared,
      showAccount,
      showCategory,
      showBalances,
      balances,
      hideFraction,
      isNew,
      isMatched,
      isExpanded,
    } = props;

    let trans = item;
    let selected = selectedItems.has(trans.id);

    let parent = props.transactionMap.get(trans.parent_id);
    let isChildDeposit = parent && parent.amount > 0;
    let expanded = isExpanded && isExpanded((parent || trans).id);

    // For backwards compatibility, read the error of the transaction
    // since in previous versions we stored it there. In the future we
    // can simplify this to just the parent
    let error = expanded
      ? (parent && parent.error) || trans.error
      : trans.error;

    return (
      <>
        {(!expanded || isLastChild(transactions, index)) &&
          error &&
          error.type === 'SplitTransactionError' && (
            <Tooltip
              position="bottom-right"
              width={250}
              forceTop={position}
              forceLayout={true}
              style={{ transform: 'translate(-5px, 2px)' }}
            >
              <TransactionError
                error={error}
                isDeposit={isChildDeposit}
                onAddSplit={() => props.onAddSplit(trans.id)}
              />
            </Tooltip>
          )}
        <Transaction
          editing={editing}
          transaction={trans}
          showAccount={showAccount}
          showCategory={showCategory}
          showBalance={showBalances}
          showCleared={showCleared}
          selected={selected}
          highlighted={false}
          added={isNew?.(trans.id)}
          expanded={isExpanded?.(trans.id)}
          matched={isMatched?.(trans.id)}
          showZeroInDeposit={isChildDeposit}
          balance={balances?.[trans.id]?.balance}
          focusedField={editing && tableNavigator.focusedField}
          accounts={accounts}
          categoryGroups={categoryGroups}
          payees={payees}
          inheritedFields={
            parent?.payee === trans.payee ? new Set(['payee']) : new Set()
          }
          dateFormat={dateFormat}
          hideFraction={hideFraction}
          onEdit={tableNavigator.onEdit}
          onSave={props.onSave}
          onDelete={props.onDelete}
          onSplit={props.onSplit}
          onManagePayees={props.onManagePayees}
          onCreatePayee={props.onCreatePayee}
          onToggleSplit={props.onToggleSplit}
          onNavigateToTransferAccount={onNavigateToTransferAccount}
          onNavigateToSchedule={onNavigateToSchedule}
        />
      </>
    );
  };

  return (
    <View
      innerRef={containerRef}
      style={[{ flex: 1, cursor: 'default' }, props.style]}
    >
      <View>
        <TransactionHeader
          hasSelected={props.selectedItems.size > 0}
          showAccount={props.showAccount}
          showCategory={props.showCategory}
          showBalance={props.showBalances}
          showCleared={props.showCleared}
          scrollWidth={scrollWidth}
          onSort={props.onSort}
          ascDesc={props.ascDesc}
          field={props.sortField}
        />

        {props.isAdding && (
          <View
            {...newNavigator.getNavigatorProps({
              onKeyDown: e => props.onCheckNewEnter(e),
            })}
          >
            <NewTransaction
              transactions={props.newTransactions}
              editingTransaction={newNavigator.editingId}
              focusedField={newNavigator.focusedField}
              accounts={props.accounts}
              categoryGroups={props.categoryGroups}
              payees={props.payees || []}
              showAccount={props.showAccount}
              showCategory={props.showCategory}
              showBalance={props.showBalances}
              showCleared={props.showCleared}
              dateFormat={dateFormat}
              hideFraction={props.hideFraction}
              onClose={props.onCloseAddTransaction}
              onAdd={props.onAddTemporary}
              onAddSplit={props.onAddSplit}
              onSplit={props.onSplit}
              onEdit={newNavigator.onEdit}
              onSave={props.onSave}
              onDelete={props.onDelete}
              onManagePayees={props.onManagePayees}
              onCreatePayee={props.onCreatePayee}
              onNavigateToTransferAccount={onNavigateToTransferAccount}
              onNavigateToSchedule={onNavigateToTransferAccount}
            />
          </View>
        )}
      </View>
      {/*// * On Windows, makes the scrollbar always appear
         //   the full height of the container ??? */}

      <View
        style={[{ flex: 1, overflow: 'hidden' }]}
        data-testid="transaction-table"
      >
        <Table
          navigator={tableNavigator}
          ref={tableRef}
          items={props.transactions}
          renderItem={renderRow}
          renderEmpty={renderEmpty}
          loadMore={props.loadMoreTransactions}
          isSelected={id => props.selectedItems.has(id)}
          onKeyDown={e => props.onCheckEnter(e)}
          onScroll={onScroll}
          saveScrollWidth={saveScrollWidth}
        />

        {props.isAdding && (
          <div
            key="shadow"
            style={{
              position: 'absolute',
              top: -20,
              left: 0,
              right: 0,
              height: 20,
              backgroundColor: 'red',
              boxShadow: '0 0 6px rgba(0, 0, 0, .20)',
            }}
          />
        )}
      </View>
    </View>
  );
}

export let TransactionTable = forwardRef((props, ref) => {
  let [newTransactions, setNewTransactions] = useState(null);
  let [prevIsAdding, setPrevIsAdding] = useState(false);
  let splitsExpanded = useSplitsExpanded();
  let prevSplitsExpanded = useRef(null);

  let tableRef = useRef(null);
  let mergedRef = useMergedRefs(tableRef, ref);

  let transactions = useMemo(() => {
    let result;
    if (splitsExpanded.state.transitionId != null) {
      let index = props.transactions.findIndex(
        t => t.id === splitsExpanded.state.transitionId,
      );
      result = props.transactions.filter((t, idx) => {
        if (t.parent_id) {
          if (idx >= index) {
            return splitsExpanded.expanded(t.parent_id);
          } else if (prevSplitsExpanded.current) {
            return prevSplitsExpanded.current.expanded(t.parent_id);
          }
        }
        return true;
      });
    } else {
      if (
        prevSplitsExpanded.current &&
        prevSplitsExpanded.current.state.transitionId != null
      ) {
        tableRef.current.anchor();
        tableRef.current.setRowAnimation(false);
      }
      prevSplitsExpanded.current = splitsExpanded;

      result = props.transactions.filter(t => {
        if (t.parent_id) {
          return splitsExpanded.expanded(t.parent_id);
        }
        return true;
      });
    }

    prevSplitsExpanded.current = splitsExpanded;
    return result;
  }, [props.transactions, splitsExpanded]);
  const transactionMap = useMemo(() => {
    return new Map(transactions.map(trans => [trans.id, trans]));
  }, [transactions]);

  useEffect(() => {
    // If it's anchored that means we've also disabled animations. To
    // reduce the chance for side effect collision, only do this if
    // we've actually anchored it
    if (tableRef.current.isAnchored()) {
      tableRef.current.unanchor();
      tableRef.current.setRowAnimation(true);
    }
  }, [prevSplitsExpanded.current]);

  let newNavigator = useTableNavigator(newTransactions, getFields);
  let tableNavigator = useTableNavigator(transactions, getFields);
  let shouldAdd = useRef(false);
  let latestState = useRef({ newTransactions, newNavigator, tableNavigator });
  let savePending = useRef(false);
  let afterSaveFunc = useRef(false);
  let [_, forceRerender] = useState({});
  let selectedItems = useSelectedItems();

  useLayoutEffect(() => {
    latestState.current = {
      newTransactions,
      newNavigator,
      tableNavigator,
      transactions: props.transactions,
    };
  });

  // Derive new transactions from the `isAdding` prop
  if (prevIsAdding !== props.isAdding) {
    if (!prevIsAdding && props.isAdding) {
      setNewTransactions(
        makeTemporaryTransactions(
          props.currentAccountId,
          props.currentCategoryId,
        ),
      );
    }
    setPrevIsAdding(props.isAdding);
  }

  useEffect(() => {
    if (shouldAdd.current) {
      if (newTransactions[0].account == null) {
        props.addNotification({
          type: 'error',
          message: 'Account is a required field',
        });
        newNavigator.onEdit('temp', 'account');
      } else {
        let transactions = latestState.current.newTransactions;
        let lastDate = transactions.length > 0 ? transactions[0].date : null;
        setNewTransactions(
          makeTemporaryTransactions(
            props.currentAccountId,
            props.currentCategoryId,
            lastDate,
          ),
        );
        newNavigator.onEdit('temp', 'date');
        props.onAdd(transactions);
      }
      shouldAdd.current = false;
    }
  });

  useEffect(() => {
    if (savePending.current && afterSaveFunc.current) {
      afterSaveFunc.current(props);
      afterSaveFunc.current = null;
    }

    savePending.current = false;
  }, [newTransactions, props.transactions]);

  function getFields(item) {
    let fields = [
      'select',
      'date',
      'account',
      'payee',
      'notes',
      'category',
      'debit',
      'credit',
      'cleared',
    ];

    fields = item.is_child
      ? ['select', 'payee', 'notes', 'category', 'debit', 'credit']
      : fields.filter(
          f =>
            (props.showAccount || f !== 'account') &&
            (props.showCategory || f !== 'category'),
        );

    if (isPreviewId(item.id)) {
      fields = ['select', 'cleared'];
    }
    if (isTemporaryId(item.id)) {
      // You can't focus the select/delete button of temporary
      // transactions
      fields = fields.slice(1);
    }

    return fields;
  }

  function afterSave(func) {
    if (savePending.current) {
      afterSaveFunc.current = func;
    } else {
      func(props);
    }
  }

  function onCheckNewEnter(e) {
    if (e.key === 'Enter') {
      if (e.metaKey) {
        e.stopPropagation();
        onAddTemporary();
      } else if (!e.shiftKey) {
        function getLastTransaction(state) {
          let { newTransactions } = state.current;
          return newTransactions[newTransactions.length - 1];
        }

        // Right now, the table navigator does some funky stuff with
        // focus, so we want to stop it from handling this event. We
        // still want enter to move up/down normally, so we only stop
        // it if we are on the last transaction (where we are about to
        // do some logic). I don't like this.
        if (newNavigator.editingId === getLastTransaction(latestState).id) {
          e.stopPropagation();
        }

        afterSave(() => {
          let lastTransaction = getLastTransaction(latestState);
          let isSplit = lastTransaction.parent_id || lastTransaction.is_parent;

          if (
            latestState.current.newTransactions[0].error &&
            newNavigator.editingId === lastTransaction.id
          ) {
            // add split
            onAddSplit(lastTransaction.id);
          } else if (
            newNavigator.editingId === lastTransaction.id &&
            (!isSplit || !lastTransaction.error)
          ) {
            onAddTemporary();
          }
        });
      }
    }
  }

  function onCheckEnter(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      let { editingId: id, focusedField } = tableNavigator;

      afterSave(() => {
        let transactions = latestState.current.transactions;
        let idx = transactions.findIndex(t => t.id === id);
        let parent = transactionMap.get(transactions[idx]?.parent_id);

        if (
          isLastChild(transactions, idx) &&
          parent &&
          parent.error &&
          focusedField !== 'select'
        ) {
          e.stopPropagation();
          onAddSplit(id);
        }
      });
    }
  }

  let onAddTemporary = useCallback(() => {
    shouldAdd.current = true;
    // A little hacky - this forces a rerender which will cause the
    // effect we want to run. We have to wait for all updates to be
    // committed (the input could still be saving a value).
    forceRerender({});
  }, [props.onAdd, newNavigator.onEdit]);

  let onSave = useCallback(
    async transaction => {
      savePending.current = true;

      if (isTemporaryId(transaction.id)) {
        if (props.onApplyRules) {
          transaction = await props.onApplyRules(transaction);
        }

        let newTrans = latestState.current.newTransactions;
        setNewTransactions(updateTransaction(newTrans, transaction).data);
      } else {
        props.onSave(transaction);
      }
    },
    [props.onSave],
  );

  let onDelete = useCallback(id => {
    let temporary = isTemporaryId(id);

    if (temporary) {
      let newTrans = latestState.current.newTransactions;

      if (id === newTrans[0].id) {
        // You can never delete the parent new transaction
        return;
      }

      setNewTransactions(deleteTransaction(newTrans, id).data);
    }
  }, []);

  let onSplit = useMemo(() => {
    return id => {
      if (isTemporaryId(id)) {
        let { newNavigator } = latestState.current;
        let newTrans = latestState.current.newTransactions;
        let { data, diff } = splitTransaction(newTrans, id);
        setNewTransactions(data);

        // Jump next to "debit" field if it is empty
        // Otherwise jump to the same field as before, but downwards
        // to the added split transaction
        if (newTrans[0].amount === null) {
          newNavigator.onEdit(newTrans[0].id, 'debit');
        } else {
          newNavigator.onEdit(
            diff.added[0].id,
            latestState.current.newNavigator.focusedField,
          );
        }
      } else {
        let trans = latestState.current.transactions.find(t => t.id === id);
        let newId = props.onSplit(id);

        splitsExpanded.dispatch({ type: 'open-split', id: trans.id });

        let { tableNavigator } = latestState.current;
        if (trans.amount === null) {
          tableNavigator.onEdit(trans.id, 'debit');
        } else {
          tableNavigator.onEdit(newId, tableNavigator.focusedField);
        }
      }
    };
  }, [props.onSplit, splitsExpanded.dispatch]);

  let onAddSplit = useCallback(
    id => {
      if (isTemporaryId(id)) {
        let newTrans = latestState.current.newTransactions;
        let { data, diff } = addSplitTransaction(newTrans, id);
        setNewTransactions(data);
        newNavigator.onEdit(
          diff.added[0].id,
          latestState.current.newNavigator.focusedField,
        );
      } else {
        let newId = props.onAddSplit(id);
        tableNavigator.onEdit(
          newId,
          latestState.current.tableNavigator.focusedField,
        );
      }
    },
    [props.onAddSplit],
  );

  function onCloseAddTransaction() {
    setNewTransactions(
      makeTemporaryTransactions(
        props.currentAccountId,
        props.currentCategoryId,
      ),
    );
    props.onCloseAddTransaction();
  }

  let onToggleSplit = useCallback(
    id => splitsExpanded.dispatch({ type: 'toggle-split', id }),
    [splitsExpanded.dispatch],
  );

  return (
    <TransactionTableInner
      tableRef={mergedRef}
      {...props}
      transactions={transactions}
      transactionMap={transactionMap}
      selectedItems={selectedItems}
      isExpanded={splitsExpanded.expanded}
      onSave={onSave}
      onDelete={onDelete}
      onSplit={onSplit}
      onCheckNewEnter={onCheckNewEnter}
      onCheckEnter={onCheckEnter}
      onAddTemporary={onAddTemporary}
      onAddSplit={onAddSplit}
      onCloseAddTransaction={onCloseAddTransaction}
      onToggleSplit={onToggleSplit}
      newTransactions={newTransactions}
      tableNavigator={tableNavigator}
      newNavigator={newNavigator}
    />
  );
});
