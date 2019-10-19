import React from 'react';
import ReactDOM from 'react-dom';
import ReactDOMServer from 'react-dom/server';
import Page from './__REACT_SSR_PAGE_NAME__';

const props = JSON.parse('__REACT_SSR_PROPS__');
const html = ReactDOMServer.renderToString(<Page {...props} />);

const hydrateByEmotion = (html) => {
  const { hydrate } = require('emotion');
  const { extractCritical } = require('emotion-server');
  const { ids } = extractCritical(html);
  hydrate(ids);
};

// const hydrateByMaterialUI = () => {
//   const { ServerStyleSheets } = require('@material-ui/core/styles');
//   const sheets = new ServerStyleSheets();
//   const html = ReactDOMServer.renderToString(
//     sheets.collect(<Page {...props} />)
//   );
// };

const withHtml = 0 <= html.indexOf('html');
const ssrSrc = document.getElementById('react-ssr-script').src;
const ssrQuery = '?' + ssrSrc.split('?')[1];
const ssrQueryObject = ssrQuery.substring(1).split('&').map((p) => p.split('=')).reduce((obj, e) => ({...obj, [e[0]]: e[1]}), {});
const ssrId = ssrQueryObject['ssrid'];

switch (ssrId) {
  case 'emotion':
    hydrateByEmotion(html);
    break;

  case 'mui':
    function MuiApp(props) {
      const [showChild, setShowChild] = React.useState(false);
      React.useEffect(() => {
        setShowChild(true);
        const jssStyles = document.getElementById('jss-server-side');
        if (jssStyles) {
          jssStyles.parentNode.removeChild(jssStyles);
        }
      }, []);
      if (!showChild) {
        return null;
      }
      return <Page {...props} />;
    }
    if (withHtml) {
      ReactDOM.hydrate(<MuiApp {...props} />, document);
    } else {
      ReactDOM.hydrate(<MuiApp {...props} />, document.getElementById('react-ssr-root'));
    }
    break;

  default:
    if (withHtml) {
      ReactDOM.hydrate(<Page {...props} />, document);
    } else {
      ReactDOM.hydrate(<Page {...props} />, document.getElementById('react-ssr-root'));
    }
    break;
}
